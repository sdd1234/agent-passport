import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { conversationFiles } from "./conversations.mjs";
import { redact } from "./importer.mjs";

const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9-]{36}$/;
const readLimit = 8 * 1024 * 1024;

function message(record, provider) {
  if (
    provider === "claude" &&
    (record.isSidechain || !["user", "assistant"].includes(record.type))
  )
    return null;
  const m =
    provider === "codex"
      ? record.type === "response_item"
        ? record.payload
        : null
      : record.message;
  if (!m || !["user", "assistant"].includes(m.role)) return null;
  const text =
    typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content
            .filter((c) =>
              ["text", "input_text", "output_text"].includes(c.type),
            )
            .map((c) => c.text || "")
            .join("\n")
        : "";
  return text.trim() ? { role: m.role, text } : null;
}

// Consume only complete JSONL records. A partial UTF-8 character/JSON line is retried next tick.
export function collectRecords(bytes, state) {
  const originalLength = bytes.length;
  if (state.closed && bytes.length && bytes[bytes.length - 1] !== 10) {
    const last = bytes.lastIndexOf(10);
    try {
      JSON.parse(bytes.subarray(last + 1).toString("utf8"));
      bytes = Buffer.concat([bytes, Buffer.from("\n")]);
    } catch {
      /* Keep an incomplete final line for diagnostics/recovery. */
    }
  }
  const end = bytes.lastIndexOf(10);
  if (end < 0)
    return { entries: [], consumed: 0, bound: state.bound, malformed: 0 };
  const entries = [];
  let bound = state.bound,
    offset = state.offset,
    malformed = 0;
  for (const raw of bytes
    .subarray(0, end + 1)
    .toString("utf8")
    .split("\n")
    .slice(0, -1)) {
    const position = offset;
    offset += Buffer.byteLength(raw) + 1;
    if (!raw.trim()) continue;
    let row;
    try {
      row = JSON.parse(raw);
    } catch {
      malformed++;
      continue;
    }
    const m = message(row, state.provider);
    if (!m) continue;
    if (!bound) {
      // Bind to the exact launch prompt, never to arbitrary assistant output mentioning the marker.
      if (m.role === "user" && m.text.startsWith(state.marker + "\n"))
        bound = true;
      continue;
    }
    if (m.text.startsWith(state.marker + "\n")) continue;
    // System-injected context and compaction summaries are not a user's conversation.
    if (
      row.isMeta ||
      row.isCompactSummary ||
      /^\s*<(?:environment_context|permissions instructions|system-reminder)>/.test(
        m.text,
      )
    )
      continue;
    const date = Number.isNaN(Date.parse(row.timestamp))
      ? new Date(state.startedAt).toISOString()
      : row.timestamp;
    const role = m.role === "user" ? "사용자" : "어시스턴트";
    const text = redact(m.text);
    let part = 0;
    for (let i = 0; i < text.length;) {
      let end = Math.min(i + 28000, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const content = `## ${date} · ${role}\n${text.slice(i, end)}`;
      const identity =
        row.uuid ||
        (row.ordinal != null ? String(row.ordinal) : String(position));
      entries.push({
        title: `${state.provider === "claude" ? "Claude" : "Codex"} 자동 기억 · ${role} · ${String(date).slice(0, 16)}${part ? " · 이어서" : ""}`,
        content,
        kind: "session",
        source: `passport-auto:/.${state.provider}/sessions/${state.id}`,
        sourceKey: digest(`${state.id}:${identity}:${part}:${content}`),
      });
      part++;
      i = end;
    }
  }
  return {
    entries,
    consumed: Math.min(end + 1, originalLength),
    bound,
    malformed,
  };
}

async function atomic(file, value) {
  const temp = file + ".tmp";
  const handle = await fs.open(temp, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}

export function autoMemory({
  root,
  owner,
  upload,
  notify = () => {},
  roots = {
    codex: path.join(
      process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
      "sessions",
    ),
    claude: path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
      "projects",
    ),
  },
}) {
  const directory = path.join(root, ".data/auto-memory", owner || "disabled");
  const records = new Map();
  let running, request;
  const file = (s) => path.join(directory, s.id + ".json");
  const ready = (async () => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    for (const name of await fs.readdir(directory)) {
      if (!name.endsWith(".json") || !uuid.test(name.slice(0, -5))) continue;
      const s = JSON.parse(
        await fs.readFile(path.join(directory, name), "utf8"),
      );
      if (
        s.owner !== owner ||
        s.id !== name.slice(0, -5) ||
        !["claude", "codex"].includes(s.provider)
      )
        continue;
      // No PTY survives a service restart. Still drain any unacknowledged transcript records.
      s.closed = true;
      records.set(s.id, s);
    }
  })();
  const writes = new Map();
  const persist = (s) => {
    const next = (writes.get(s.id) || Promise.resolve())
      .catch(() => {})
      .then(() => atomic(file(s), s));
    writes.set(s.id, next);
    return next;
  };
  async function discover(s) {
    const found = [];
    for (const candidate of await conversationFiles(roots[s.provider])) {
      if (candidate.includes(`${path.sep}subagents${path.sep}`)) continue;
      if (
        s.provider === "claude" &&
        path.basename(candidate) !== s.id + ".jsonl"
      )
        continue;
      const stat = await fs.stat(candidate);
      if (stat.mtimeMs < s.startedAt - 2000) continue;
      const handle = await fs.open(candidate, "r");
      try {
        const bytes = Buffer.alloc(Math.min(stat.size, readLimit));
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const header = bytes.subarray(0, bytesRead).toString("utf8");
        let correctCwd = false,
          marker = false;
        for (const raw of header.split("\n")) {
          let row;
          try {
            row = JSON.parse(raw);
          } catch {
            continue;
          }
          const cwd =
            s.provider === "codex" && row.type === "session_meta"
              ? row.payload?.cwd
              : row.cwd;
          if (cwd && path.resolve(cwd) === path.resolve(s.cwd))
            correctCwd = true;
          const m = message(row, s.provider);
          if (m?.role === "user" && m.text.startsWith(s.marker + "\n"))
            marker = true;
        }
        if (correctCwd && marker) found.push(candidate);
      } finally {
        await handle.close();
      }
    }
    if (found.length > 1) throw Error("AMBIGUOUS_TRANSCRIPT");
    if (found.length === 1) {
      s.source = found[0];
      await persist(s);
    }
  }
  async function collect(s) {
    if (!s.source) await discover(s);
    if (!s.source) return;
    const stat = await fs.lstat(s.source);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error("TRANSCRIPT_UNAVAILABLE");
    if (stat.size < s.offset) throw Error("TRANSCRIPT_TRUNCATED");
    if (stat.size === s.offset) {
      s.unread = false;
      return;
    }
    const handle = await fs.open(s.source, "r");
    try {
      const bytes = Buffer.alloc(Math.min(stat.size - s.offset, readLimit));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, s.offset);
      const result = collectRecords(bytes.subarray(0, bytesRead), s);
      if (result.consumed === 0 && bytesRead === readLimit)
        throw Error("TRANSCRIPT_RECORD_TOO_LARGE");
      const seen = new Set([
        ...s.savedKeys,
        ...s.pending.map((e) => e.sourceKey),
      ]);
      for (const e of result.entries)
        if (!seen.has(e.sourceKey)) {
          s.pending.push(e);
          seen.add(e.sourceKey);
        }
      s.bound = result.bound;
      s.offset += result.consumed;
      s.unread = stat.size > s.offset;
      if (s.closed && !result.consumed && s.unread)
        throw Error("INCOMPLETE_TRANSCRIPT");
      s.malformed += result.malformed;
      // Advance only after sanitized pending records are durable; HTTP retries use stable source keys.
      await persist(s);
    } finally {
      await handle.close();
    }
  }
  const status = (folderId) => {
    const list = [...records.values()].filter(
      (s) => !folderId || s.folderId === folderId,
    );
    const pending = list.reduce((n, s) => n + s.pending.length, 0),
      saved = list.reduce((n, s) => n + s.savedKeys.length, 0);
    const error = list.find((s) => s.error)?.error || "";
    const waiting = list.some((s) => !s.source && !s.finished);
    return {
      state: error
        ? "error"
        : pending || list.some((s) => s.unread)
          ? "pending"
          : waiting
            ? "waiting"
            : saved
              ? "saved"
              : "ready",
      saved,
      pending,
      lastSavedAt: Math.max(0, ...list.map((s) => s.lastSavedAt || 0)),
      code: error,
      malformed: list.reduce((n, s) => n + s.malformed, 0),
    };
  };
  async function sync() {
    await ready;
    for (const s of records.values()) {
      if (s.finished && !s.pending.length) continue;
      try {
        s.error = "";
        if (s.pending.length < 100) await collect(s);
        if (s.pending.length && request) {
          const batch = s.pending.slice(0, 100);
          await upload(request, s.folderId, batch);
          s.savedKeys.push(...batch.map((e) => e.sourceKey));
          s.pending.splice(0, batch.length);
          s.lastSavedAt = Date.now();
          await persist(s);
        }
        if (
          s.closed &&
          !s.pending.length &&
          s.source &&
          (await fs.stat(s.source)).size === s.offset
        ) {
          s.finished = true;
          await persist(s);
        }
        if (!s.source && Date.now() - s.startedAt > 60000)
          s.error = "TRANSCRIPT_NOT_FOUND";
      } catch (e) {
        s.error = [
          "TRANSCRIPT_TRUNCATED",
          "INCOMPLETE_TRANSCRIPT",
          "TRANSCRIPT_RECORD_TOO_LARGE",
          "AMBIGUOUS_TRANSCRIPT",
        ].includes(e.message)
          ? e.message
          : "SAVE_RETRY_REQUIRED";
      }
      notify(s.folderId, status(s.folderId));
    }
  }
  const tick = () =>
    running ||
    (running = sync().finally(() => {
      running = undefined;
    }));
  return {
    ready,
    status,
    tick,
    useRequest(req) {
      request = req;
    },
    async start({ folderId, provider, cwd }) {
      await ready;
      const id = crypto.randomUUID();
      const s = {
        id,
        owner,
        folderId,
        provider,
        cwd,
        startedAt: Date.now(),
        marker: `[Passport work session ${id}]`,
        source: "",
        bound: false,
        offset: 0,
        savedKeys: [],
        pending: [],
        malformed: 0,
        lastSavedAt: 0,
        closed: false,
        finished: false,
      };
      records.set(id, s);
      await persist(s);
      return { id, marker: s.marker };
    },
    async close(id) {
      await ready;
      if (running) await running;
      const s = records.get(id);
      if (s) {
        s.closed = true;
        s.finished = false;
        await persist(s);
      }
      await tick();
    },
  };
}
