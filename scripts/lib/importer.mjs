import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
export function redact(text) {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED TOKEN]",
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]\s*)(["']?)[^\s,"'}]+/gi,
      "$1[REDACTED]",
    );
}
async function regular(file) {
  try {
    const s = await fs.lstat(file);
    return s.isFile() && !s.isSymbolicLink() && s.size <= 16 * 1024 * 1024;
  } catch {
    return false;
  }
}
async function walk(root, accept, depth = 0) {
  if (depth > 8) return [];
  const st = await fs.lstat(root).catch(() => null);
  if (!st?.isDirectory() || st.isSymbolicLink()) return [];
  const children = await fs.readdir(root, { withFileTypes: true });
  const out = [];
  for (const d of children) {
    if (d.isSymbolicLink()) continue;
    const p = path.join(root, d.name);
    if (d.isDirectory()) out.push(...(await walk(p, accept, depth + 1)));
    else if (d.isFile() && accept(p) && (await regular(p))) out.push(p);
    if (out.length > 2000)
      throw new Error(
        "Too many local files; select a project or reduce the input directory.",
      );
  }
  return out;
}
export async function parseSession(file, provider, includeText) {
  if (!(await regular(file))) return { cwd: "", text: "" };
  let cwd = "",
    parts = [],
    chars = 0;
  const stream = createReadStream(file, { encoding: "utf8" }),
    lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.length > 1000000) continue;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      if (provider === "codex" && data.type === "session_meta")
        cwd = data.payload?.cwd || cwd;
      if (provider === "claude" && typeof data.cwd === "string") cwd = data.cwd;
      if (!includeText && cwd) break;
      if (!includeText) continue;
      const m =
        provider === "codex" && data.type === "response_item"
          ? data.payload
          : provider === "claude"
            ? data.message
            : null;
      if (!m || !["user", "assistant"].includes(m.role)) continue;
      // Never import tool results, reasoning, system prompts, credentials or local snapshots.
      const content =
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
      if (content.trim()) {
        parts.push(`${m.role}: ${content}`);
        chars += content.length;
      }
      if (chars > 250000) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return { cwd, text: parts.join("\n\n") };
}
export async function collect({
  home,
  codexHome = path.join(home, ".codex"),
  claudeHome = path.join(home, ".claude"),
  projects = [],
  includeSessions = false,
}) {
  const entries = [],
    warnings = [];
  let total = 0;
  const append = (provider, file, project, content, kind) => {
    content = redact(content);
    if (!content.trim()) return;
    for (let offset = 0; offset < content.length; offset += 30000) {
      const part = content.slice(offset, offset + 30000);
      total += Buffer.byteLength(part);
      if (total > 8 * 1024 * 1024)
        throw new Error("Export exceeds 8 MB. Select fewer projects.");
      if (entries.length >= 1000)
        throw new Error("Export exceeds 1,000 entries. Select fewer projects.");
      entries.push({
        provider,
        projectPath: project || "",
        projectName: project ? path.basename(project) : "분류 필요",
        title: `${path.basename(file)}${content.length > 30000 ? ` · ${offset / 30000 + 1}` : ""}`,
        content: part,
        source: file,
        sourceKey: hash(provider + "\0" + file + "\0" + offset + "\0" + part),
        kind,
      });
    }
  };
  const selected = (p) =>
    !projects.length ||
    projects.some((root) => p === root || p.startsWith(root + path.sep));
  for (const provider of ["codex", "claude"]) {
    const base =
      provider === "codex"
        ? path.join(codexHome, "sessions")
        : path.join(claudeHome, "projects");
    const sessions = await walk(base, (p) => p.endsWith(".jsonl"));
    const paths = new Map();
    for (const file of sessions) {
      const result = await parseSession(file, provider, includeSessions);
      if (result.cwd) paths.set(path.dirname(file), result.cwd);
      if (includeSessions && selected(result.cwd))
        append(provider, file, result.cwd, result.text, "session");
    }
    const memoryRoot =
      provider === "codex" ? path.join(codexHome, "memories") : base;
    for (const file of await walk(
      memoryRoot,
      (p) =>
        p.endsWith(".md") &&
        (provider === "codex" || p.includes(path.sep + "memory" + path.sep)),
    )) {
      const project =
        provider === "claude"
          ? paths.get(path.dirname(path.dirname(file))) || ""
          : "";
      if (project && !selected(project)) continue;
      append(
        provider,
        file,
        project,
        await fs.readFile(file, "utf8"),
        "memory",
      );
    }
  }
  for (const project of projects)
    for (const name of ["MEMORY.md", "AGENTS.md", "CLAUDE.md"]) {
      const file = path.join(project, name);
      if (await regular(file))
        append(
          "project",
          file,
          project,
          await fs.readFile(file, "utf8"),
          "memory",
        );
    }
  if (!entries.length)
    warnings.push(
      "지원하는 기억 파일이 없습니다. --project 경로를 지정하거나 --include-sessions로 대화 기록을 선택하세요.",
    );
  warnings.push(
    "자동 비밀정보 제거는 완전하지 않습니다. 서버 업로드 전에 GUI에서 내용을 검토하세요. 긴 세션은 처음 약 250,000자만 수집합니다.",
  );
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    entries,
    warnings,
  };
}
