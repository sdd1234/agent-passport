import React, { useMemo, useState } from "react";
import { buildTimeline, type TimelineSource } from "./lib/timeline.mjs";
export function ProjectTimeline({
  entries,
  onSource,
}: {
  entries: any[];
  onSource: (id: string) => void;
}) {
  const days = useMemo(() => buildTimeline(entries), [entries]);
  const [reverse, setReverse] = useState(false),
    [expanded, setExpanded] = useState<Record<string, number>>({});
  const ordered = reverse
    ? [...days.filter((d) => d.date)]
        .reverse()
        .concat(days.filter((d) => !d.date))
    : days;
  const source = (s: TimelineSource) => (
    <button
      className="timeline-source"
      key={s.entryId}
      onClick={() => onSource(s.entryId)}
    >
      원문 · {s.title}
    </button>
  );
  return (
    <section className="project-timeline">
      <div className="timeline-toolbar">
        <div>
          <h3>작업 타임라인</h3>
          <p>무엇을 했고, 무엇을 하기로 했는지 날짜별로 확인하세요.</p>
        </div>
        <button onClick={() => setReverse((v) => !v)}>
          {reverse ? "최신순 ↓" : "시간순 ↑"}
        </button>
      </div>
      {!days.length && (
        <div className="timeline-empty">
          아직 작업 기록이 없습니다. 기억이나 대화를 가져오면 여기에 정리됩니다.
        </div>
      )}
      {ordered.map((day) => (
        <details
          className="timeline-day"
          key={day.date || "undated"}
          onToggle={(e) => {
            if (e.currentTarget.open && !expanded[day.date])
              setExpanded((v) => ({ ...v, [day.date]: 30 }));
          }}
        >
          <summary>
            <div className="timeline-date">
              <time>
                {day.date ? day.date.replaceAll("-", ". ") : "날짜 미상"}
              </time>
              <span>
                {day.items.length}개 기록 · 원문 {day.sources.length}개
              </span>
            </div>
            <div className="timeline-preview">
              {day.highlights.length ? (
                day.highlights.map((item, i) => (
                  <p key={i}>
                    <span className={`timeline-badge ${item.category}`}>
                      {item.label}
                    </span>
                    {item.summary}
                  </p>
                ))
              ) : (
                <p>
                  작업 내용을 판단할 근거가 부족합니다. 상세에서 원문을
                  확인하세요.
                </p>
              )}
              <small>
                상세 보기 <span aria-hidden="true">↗</span>
              </small>
            </div>
          </summary>
          {!!expanded[day.date] && (
            <div className="timeline-detail">
              <p className="timeline-note">
                당시의 요청·작업 보고를 구분했습니다. 날짜는 원문 기준이며, 이후
                변경 사항은 다음 날짜의 기록에서 확인하세요.
              </p>
              {day.items.slice(0, expanded[day.date]).map((item, i) => (
                <div className="timeline-event" key={i}>
                  <span className={`timeline-badge ${item.category}`}>
                    {item.label}
                  </span>
                  <p>{item.text}</p>
                  <small>
                    {item.role}
                    {item.timestamp &&
                      " · " +
                        new Date(item.timestamp).toLocaleTimeString("ko-KR", {
                          timeZone: "Asia/Seoul",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </small>
                  <div>{item.sources.map(source)}</div>
                </div>
              ))}
              {day.items.length > expanded[day.date] && (
                <button
                  onClick={() =>
                    setExpanded((v) => ({ ...v, [day.date]: v[day.date] + 30 }))
                  }
                >
                  기록 30개 더 보기
                </button>
              )}
              <details className="timeline-originals">
                <summary>이 날짜의 원문 {day.sources.length}개</summary>
                {day.sources.map(source)}
              </details>
            </div>
          )}
        </details>
      ))}
    </section>
  );
}
