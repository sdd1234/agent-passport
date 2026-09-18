// Extract source-backed statements. Import timestamps are never project events.
export function buildOverview(entries) {
  const sections = { goal: [], decision: [], progress: [], next: [] };
  const seen = {
    goal: new Set(),
    decision: new Set(),
    progress: new Set(),
    next: new Set(),
  };
  const labels = [
    [
      "next",
      /다음|남은|할 일|해야|미구현|미완료|\btodo\b|\bnext\b|\bremaining\b|\bblocked\b/i,
    ],
    ["goal", /목표|목적|요구사항|방향|\bgoal\b|\bpurpose\b|\bobjective\b/i],
    [
      "decision",
      /결정|선택|확정|채택|\bdecision\b|\bchoose\b|\bchose\b|\bagreed\b/i,
    ],
    [
      "progress",
      /진행|완료|구현|검증|상태|\bprogress\b|\bcompleted\b|\bimplemented\b|\bstatus\b/i,
    ],
  ];
  for (const entry of entries) {
    if (entry.state && entry.state !== "approved") continue;
    let section = { todo: "next", decision: "decision", progress: "progress" }[
      entry.kind
    ];
    let date = "";
    let code = false;
    let frontmatter = false;
    const lines = String(entry.content || "").split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim();
      if (line.startsWith("```")) {
        code = !code;
        continue;
      }
      if (code) continue;
      if (line === "---" && (index === 0 || frontmatter)) {
        frontmatter = !frontmatter;
        continue;
      }
      if (frontmatter) continue;
      const heading = /^#{1,6}\s/.test(line);
      if (heading || /[:：]$/.test(line)) {
        section = labels.find(([, re]) => re.test(line))?.[0];
        date = line.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] || "";
        continue;
      }
      const text = line
        .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s*)/, "")
        .replace(/\*\*/g, "")
        .trim();
      if (!text || text.length < 8 || /^\||^<!--/.test(text)) continue;
      const category =
        labels.find(([, re]) => re.test(text))?.[0] || section || "goal";
      const items = sections[category];
      if (!seen[category].has(text))
        items.push({
          text,
          entryId: entry.id,
          title: entry.title,
          date: text.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] || date,
        });
      seen[category].add(text);
    }
  }
  return sections;
}
