// Evidence-led daily digest: distinguish requests, reported results and plans.
// Dates come only from source text; database/import timestamps are not work dates.
const datePattern = /\b20\d{2}-\d{2}-\d{2}\b/g;
const labels = {
  done: "작업 내용",
  decision: "결정한 일",
  next: "다음 작업",
  request: "요청한 일",
  context: "프로젝트 맥락",
  state: "기록된 구성",
};
function dayOf(value) {
  if (/T/.test(value) && !Number.isNaN(Date.parse(value))) {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  }
  const date = value.match(datePattern)?.[0] || "";
  return date && !Number.isNaN(Date.parse(date)) ? date : "";
}
function clean(line) {
  return line
    .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s*)/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`[^`]*(?:[\/\\]|\.(?:gd|tscn|tsx?|json|md))[^`]*`/g, "")
    .replace(/\*\*|`/g, "")
    .replace(
      /(?:[A-Za-z]:[\\/]|\/(?:home|mnt|Users|tmp|work)\/)[^\s,;）)]+/g,
      "",
    )
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function classify(text, role, section, kind) {
  if (
    !role &&
    /구조|구성/.test(section) &&
    /^(적|무기|픽업|특수 이벤트|HUD)/.test(text)
  )
    return "state";
  if (/^(?:성격|Why|목표|목적)\s*[:：]/i.test(text)) return "context";

  if (
    /미완료|미구현|완료하지|완료되지|구현하지|구현되지|못했|not (?:implemented|completed)|실패|차단|남은|다음(?: 작업| 단계|:)|해야|할 예정|예정|할 계획|하겠습니다|할게요|\btodo\b|\bnext\b|\bremaining\b|\bblocked\b/i.test(
      text,
    )
  )
    return role === "사용자" ? "request" : "next";
  if (role === "사용자")
    return /해줘|해봐|하자|ㄱㄱ|만들|수정|구현|추가|삭제|바꿔|원함|원하는|요청|please|want|implement/i.test(
      text,
    )
      ? "request"
      : null;
  if (
    /결정|채택|확정|하기로|유지하기|방향|\bchoose\b|\bchose\b|\bagreed\b/i.test(
      text,
    )
  )
    return "decision";
  if (
    /완료|구현|수정|적용|추가|제거|개선|검증|통과|해결|저장|배포|연결|성공|실행|구성|변경|completed|implemented|fixed|verified/i.test(
      text,
    )
  )
    return "done";
  if (/다음|남은|계획|할 일|todo|next/i.test(section) || kind === "todo")
    return "next";
  if (/결정|decision/i.test(section) || kind === "decision") return "decision";
  if (/성격|목표|목적|why|배경/i.test(text + " " + section)) return "context";
  return null;
}
export function buildTimeline(entries) {
  const days = new Map();
  const ensure = (date) => {
    if (!days.has(date))
      days.set(date, { date, items: [], sources: new Map(), seen: new Map() });
    return days.get(date);
  };
  for (const entry of entries) {
    if (entry.state && entry.state !== "approved") continue;
    let body = String(entry.content || "").replace(
      /^\s*-{2,3}\s*\n[\s\S]*?\n---\s*(?:\n|$)/,
      "",
    );
    const dates = [...new Set(body.match(datePattern) || [])];
    let date =
      entry.kind === "session" ? "" : dates.length === 1 ? dayOf(dates[0]) : "";
    let timestamp = "";
    let role = "",
      section = "",
      fenced = false,
      tagged = false,
      added = false;
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      const message = line.match(/^##\s+(\S+)\s+·\s+(사용자|어시스턴트)/);
      if (message) {
        date = dayOf(message[1]);
        timestamp =
          message[1].includes("T") && !Number.isNaN(Date.parse(message[1]))
            ? new Date(message[1]).toISOString()
            : "";
        role = message[2];
        section = "";
        fenced = false;
        tagged = false;
        continue;
      }
      if (/^```|^~~~/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      if (
        /^<(?:system|environment|skills|instructions|user_instructions)/i.test(
          line,
        )
      )
        tagged = true;
      if (tagged) {
        if (/<\//.test(line)) tagged = false;
        continue;
      }
      if (/^#{1,6}\s/.test(line)) {
        section = line.replace(/^#+\s*/, "");
        if (!role) date = dayOf(line) || date;
        continue;
      }
      if (/^\*\*[^*]+\*\*\s*[:：]?\s*$/.test(line)) {
        section = clean(line);
        continue;
      }
      if (
        !line ||
        /^\||^[{}\[\]]|^<|^---|^(?:name|description|metadata|node_type|originSessionId|type):/i.test(
          line,
        )
      )
        continue;
      if (
        /^(?:\*\*)?(?:위치|경로|진입|본체|구조|출처|관련|location|path|source)(?:\*\*)?\s*[:：]/i.test(
          line,
        )
      )
        continue;
      const text = clean(line);
      if (
        text.length < 12 ||
        text.length > 1600 ||
        /^[\w./\\-]+\.(?:gd|ts|tsx|json|md|tscn)\b/.test(text)
      )
        continue;
      const category = classify(text, role, section, entry.kind);
      if (!category) continue;
      // Imperative how-to snippets are instructions, not evidence of completed work.
      if (
        category === "done" &&
        /how to apply|사용법|적용 방법/i.test(section + " " + text)
      )
        continue;
      const target = ensure(date),
        key = category + "\0" + text;
      const source = { entryId: entry.id, title: entry.title };
      target.sources.set(entry.id, source);
      if (target.seen.has(key)) {
        const item = target.seen.get(key);
        if (!item.sources.some((s) => s.entryId === entry.id))
          item.sources.push(source);
        added = true;
        continue;
      }
      let summary = text
        .replace(
          /^(?:작업 결과|진행 상황|결과|성격|Why|How to apply)\s*[:：]\s*/i,
          "",
        )
        .replace(/\s*\([^)]*(?:Windows|커밋)[^)]*\)/g, "");
      if (category === "state") {
        const count = text.match(/^(적|무기)\s*(\d+)종/);
        if (count)
          summary = `${count[1]} ${count[2]}종${/시간대별/.test(text) ? "을 시간대별로 등장시키는 구성" : "을 포함한 구성"}이 기록되어 있습니다.`;
        else if (/^HUD/.test(text))
          summary =
            text.replace(/^HUD\s*/, "화면에 ").replace(/\s*\([^)]*\)/g, "") +
            "를 적용한 상태입니다.";
      }
      const sentences = summary.split(/(?<=[.!?。])\s+/);
      const short = sentences[0].length >= 16 ? sentences[0] : summary;
      const item = {
        category,
        timestamp,
        label: labels[category],
        summary: short.length > 160 ? short.slice(0, 157) + "…" : short,
        text,
        role: role || "기억 기록",
        sources: [source],
      };
      target.items.push(item);
      target.seen.set(key, item);
      added = true;
    }
    // No claim is invented when a source contains only technical metadata.
    if (!added) {
      const target = ensure(date);
      target.sources.set(entry.id, { entryId: entry.id, title: entry.title });
    }
  }
  return [...days.values()]
    .sort((a, b) =>
      a.date ? (b.date ? a.date.localeCompare(b.date) : -1) : b.date ? 1 : 0,
    )
    .map(({ date, items, sources }) => {
      items.sort((a, b) =>
        a.timestamp && b.timestamp
          ? a.timestamp.localeCompare(b.timestamp)
          : a.timestamp
            ? -1
            : b.timestamp
              ? 1
              : 0,
      );
      const highlights = [
        "done",
        "state",
        "decision",
        "next",
        "request",
        "context",
      ]
        .flatMap((category) =>
          items
            .filter((i) => i.category === category)
            .sort((a, b) =>
              category === "state"
                ? Number(/종을/.test(b.summary)) -
                  Number(/종을/.test(a.summary))
                : 0,
            )
            .slice(0, category === "state" ? 2 : 1),
        )
        .slice(0, 3);
      return { date, items, sources: [...sources.values()], highlights };
    });
}
