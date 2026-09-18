export type Organizable = {
  title: string;
  content: string;
  source: string;
  kind?: string;
  projectName?: string;
  projectPath?: string;
  [key: string]: unknown;
};
export function organizeEntries<T extends Organizable>(
  entries: T[],
): {
  entries: (T & { group: string; similarity: number })[];
  groups: {
    name: string;
    entries: (T & { group: string; similarity: number })[];
  }[];
  duplicates: number;
};
