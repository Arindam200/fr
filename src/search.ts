// Fans one question out over every file: one Jev decision per file, run in parallel.
import { decide, type Decision, type JevConfig } from "./decide.ts";
import type { FileEntry } from "./walk.ts";

export const ANSWERS = ["relevant", "maybe", "irrelevant"] as const;
export type Answer = (typeof ANSWERS)[number];
const CRITERIA: Record<Answer, string> = {
  relevant: "The file directly implements or documents what the question asks about",
  maybe: "The file touches the topic indirectly or is likely needed as supporting context",
  irrelevant: "The file has nothing to do with the question",
};
export const rank: Record<Answer, number> = { relevant: 0, maybe: 1, irrelevant: 2 };
export const byRank = (a: Row, b: Row) => rank[a.answer] - rank[b.answer] || b.confidence - a.confidence;

export type Row = { path: string; cached?: boolean } & Decision<Answer>;
export type SearchResult = { rows: Row[]; failure?: Error };

export const normalize = (q: string) => q.trim().replace(/\s+/g, " ");

// Decisions are memoized per (question, file), so re-asking a question, recalling it from
// history, or backspacing to it while typing costs nothing. Cleared on :reindex.
const cache = new Map<string, Row>();
export const clearCache = () => cache.clear();

// Cache hits are reported first (synchronously), then each fresh decision the moment Jev
// returns it. Stops early on abort or on the first API error.
export async function search(
  question: string,
  files: FileEntry[],
  jev: JevConfig,
  concurrency: number,
  signal: AbortSignal,
  onRow: (row: Row) => void,
): Promise<SearchResult> {
  const rows: Row[] = [];
  const key = (f: FileEntry) => `${normalize(question)}\n${f.path}`;
  const add = (row: Row) => (rows.push(row), onRow(row));
  const queue = files.filter((f) => {
    const hit = cache.get(key(f));
    if (hit) add(hit);
    return !hit;
  });
  let failure: Error | undefined;

  async function worker() {
    for (let f = queue.shift(); f && !signal.aborted && !failure; f = queue.shift()) {
      try {
        const d = await decide(
          {
            question: `Is this file useful for answering: "${question}"?`,
            answers: ANSWERS,
            criteria: CRITERIA,
            context: { text: `path: ${f.path}\n\n${f.preview}` },
          },
          jev,
          signal,
        );
        cache.set(key(f), { path: f.path, ...d, cached: true });
        add({ path: f.path, ...d });
      } catch (e) {
        if (!signal.aborted) failure ??= e as Error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { rows, failure };
}
