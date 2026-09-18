export type TimelineSource = { entryId: string; title: string };
export type TimelineItem = {
  category: string;
  timestamp: string;
  label: string;
  summary: string;
  text: string;
  role: string;
  sources: TimelineSource[];
};
export type TimelineDay = {
  date: string;
  items: TimelineItem[];
  sources: TimelineSource[];
  highlights: TimelineItem[];
};
export function buildTimeline(entries: any[]): TimelineDay[];
