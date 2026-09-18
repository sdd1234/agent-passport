export type OverviewItem = {
  text: string;
  entryId: string;
  title: string;
  date: string;
};
export function buildOverview(
  entries: any[],
): Record<"goal" | "decision" | "progress" | "next", OverviewItem[]>;
