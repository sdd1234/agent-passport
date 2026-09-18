// Local content analysis: reads the complete text, never sends it to a model provider.
const stop = new Set(
  "project memory memories feedback reference progress session note decision todo md txt json user assistant claude codex name type description true false http https home users 작업 내용 기억 사용 현재 관련 확인 진행 완료 파일 프로젝트 저장 다음 경우 필요 방법 설정".split(
    " ",
  ),
);
const words = (s) =>
  (s.toLowerCase().match(/[a-z][a-z0-9]{2,}|[가-힣]{2,}/g) || []).filter(
    (w) => !stop.has(w),
  );
const basename = (s) => (s || "").replace(/\\/g, "/").split("/").pop() || "";
const stem = (e) =>
  basename(e.source || e.title)
    .replace(/\.(md|txt|json)$/i, "")
    .replace(/\s*·\s*\d+$/, "")
    .toLowerCase();
const pretty = (s) =>
  s
    .split(/[_-]/)
    .map((w) =>
      w.length <= 3 ? w.toUpperCase() : w[0]?.toUpperCase() + w.slice(1),
    )
    .join(" ");
const generic = (s) =>
  !s ||
  /^(g-p-|[a-f0-9]{16,}$)/i.test(s) ||
  /^(분류 필요|memory|memories|전체 기억|공통|claude|codex|wsl|windows|home)(\b|\s| ·)/i.test(
    s,
  );
const normalize = (s) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
export function organizeEntries(entries) {
  const corpus = entries.map((e) => {
    const counts = new Map();
    for (const w of words(e.content)) counts.set(w, (counts.get(w) || 0) + 1);
    for (const w of words(e.title + " " + stem(e)))
      counts.set(w, (counts.get(w) || 0) + 5);
    return counts;
  });
  const df = new Map();
  for (const c of corpus)
    for (const w of c.keys()) df.set(w, (df.get(w) || 0) + 1);
  const vectors = corpus.map(
    (c) =>
      new Map(
        [...c].map(([w, n]) => [
          w,
          (1 + Math.log(n)) * Math.log(1 + entries.length / (df.get(w) || 1)),
        ]),
      ),
  );
  const cosine = (a, b) => {
    let dot = 0,
      aa = 0,
      bb = 0;
    for (const [w, n] of a) {
      aa += n * n;
      dot += n * (b.get(w) || 0);
    }
    for (const n of b.values()) bb += n * n;
    return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
  };
  const families = new Map();
  entries.forEach((e, i) => {
    const s = stem(e);
    if (!s.startsWith("project_") && !s.startsWith("project-")) return;
    const parts = s.replace(/^project[_-]/, "").split(/[_-]/);
    const key = parts[0];
    if (!families.has(key)) families.set(key, []);
    families.get(key).push({ parts, index: i });
  });
  const anchors = [];
  const assigned = new Map();
  for (const [key, files] of families) {
    let common = [...files[0].parts];
    for (const f of files)
      common = common.filter((p, i) =>
        common.slice(0, i + 1).every((v, n) => v === f.parts[n]),
      );
    const meaningful = common.filter((w) => !/^\d|^v\d/.test(w));
    const label = pretty(meaningful.slice(0, 2).join("_") || key);
    const terms = meaningful.slice(0, 2);
    anchors.push({ label, terms, indices: files.map((f) => f.index) });
    for (const f of files) assigned.set(f.index, label);
  }
  // Explicit project names and actual project directories are stronger than similarity.
  entries.forEach((e, i) => {
    if (assigned.has(i)) return;
    const n = (e.projectName || "").trim();
    const dir = basename(e.projectPath || "");
    let label = !generic(n)
      ? n
      : !generic(dir) && !dir.startsWith(".")
        ? pretty(dir)
        : "";
    if (
      /^(MEMORY|AGENTS|CLAUDE)\.md$/i.test(basename(e.source)) &&
      dir &&
      !generic(dir) &&
      !dir.startsWith(".")
    )
      label = pretty(dir);
    if (label) {
      assigned.set(i, label);
      const found = anchors.find((a) => a.label === label);
      if (found) found.indices.push(i);
      else anchors.push({ label, terms: words(label), indices: [i] });
    }
  });
  const organized = entries.map((e, i) => {
    let group = assigned.get(i),
      similarity = 0;
    if (!group && /wsl|windows|cloudflare|ollama|blender/.test(stem(e)))
      group = "환경·도구";
    if (!group) {
      const scores = anchors
        .map((a) => {
          const title = words(stem(e) + " " + e.title);
          const keyword = a.terms.some((t) => title.includes(t)) ? 1 : 0;
          const bodyHits = a.terms.filter((t) => corpus[i].has(t)).length;
          const sim = Math.max(
            0,
            ...a.indices.map((n) => cosine(vectors[i], vectors[n])),
          );
          return {
            ...a,
            score:
              keyword * 2 +
              sim +
              (bodyHits === a.terms.length && a.terms.length ? 0.45 : 0),
            sim,
            primary: a.terms.some((t) => t === a.terms[0] && corpus[i].has(t)),
          };
        })
        .sort((a, b) => b.score - a.score);
      const first = scores[0],
        second = scores[1];
      if (
        first &&
        (first.score >= 2 ||
          (first.score >= 0.4 &&
            (first.primary || first.sim >= 0.72) &&
            first.score - (second?.score || 0) >= 0.09))
      ) {
        group = first.label;
        similarity = first.sim;
      }
    }
    if (!group) {
      const t = stem(e);
      group = /wsl|windows|cloudflare|ollama|blender/.test(t)
        ? "환경·도구"
        : t.startsWith("feedback")
          ? "작업 방식·선호"
          : t.startsWith("reference")
            ? "참고 자료"
            : "공통 기억";
    }
    return { ...e, group, similarity };
  });
  const seen = new Set();
  let duplicates = 0;
  const unique = [];
  for (const e of organized) {
    const key =
      e.group + "\0" + (e.kind || "memory") + "\0" + normalize(e.content);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(e);
  }
  const groups = [...new Set(unique.map((e) => e.group))]
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => ({ name, entries: unique.filter((e) => e.group === name) }));
  return { entries: unique, groups, duplicates };
}
