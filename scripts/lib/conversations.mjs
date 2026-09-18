import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import crypto from "node:crypto";
import { redact } from "./importer.mjs";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
export async function conversationFiles(root) {
  const out = [];
  async function visit(dir) {
    const children = await fs
      .readdir(dir, { withFileTypes: true })
      .catch((e) => {
        if (e.code === "ENOENT") return [];
        throw e;
      });
    for (const item of children) {
      if (item.isSymbolicLink()) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await visit(file);
      else if (item.isFile() && file.endsWith(".jsonl")) out.push(file);
    }
  }
  await visit(root);
  return out.sort();
}
export async function readConversation(file, provider) {
  // Freeze the byte boundary so a running session cannot import its own growing output forever.
  const size = (await fs.stat(file)).size;
  if (!size)
    return { cwd: "", entries: [], messages: 0, malformed: 0, bytes: 0 };
  const stream = createReadStream(file, {
    encoding: "utf8",
    start: 0,
    end: size - 1,
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let cwd = "",
    messages = 0,
    malformed = 0,
    buffer = "",
    part = 0;
  const entries = [],
    seen = new Set();
  function flush() {
    if (!buffer) return;
    entries.push({
      provider,
      kind: "session",
      title: `${provider === "codex" ? "Codex" : "Claude"} 대화 · ${path.basename(file, ".jsonl").slice(-36)} · ${++part}`,
      content: buffer,
      source: file,
      sourceKey: hash(provider + "\0" + file + "\0" + part + "\0" + buffer),
    });
    buffer = "";
  }
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        malformed++;
        continue;
      }
      if (provider === "codex" && data.type === "session_meta")
        cwd = data.payload?.cwd || cwd;
      if (provider === "claude" && data.cwd) cwd = data.cwd;
      const m =
        provider === "codex"
          ? data.type === "response_item"
            ? data.payload
            : null
          : data.message;
      if (!m || !["user", "assistant"].includes(m.role)) continue;
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
      if (!text.trim()) continue;
      const id = data.uuid || (m.id ? `${m.id}:${hash(text)}` : "");
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      messages++;
      let record = `\n\n## ${data.timestamp || "날짜 미기록"} · ${m.role === "user" ? "사용자" : "어시스턴트"}\n${redact(text)}`;
      while (record.length) {
        let room = 30000 - buffer.length;
        if (room < 2) {
          flush();
          room = 30000;
        }
        let end = Math.min(room, record.length);
        if (end < record.length && /[\uD800-\uDBFF]/.test(record[end - 1]))
          end--;
        buffer += record.slice(0, end);
        record = record.slice(end);
        if (buffer.length >= 29999) flush();
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  flush();
  return { cwd, entries, messages, malformed, bytes: size };
}
