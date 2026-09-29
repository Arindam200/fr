import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "target", "__pycache__", "venv", ".venv", "coverage"]);
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".lock", ".woff", ".woff2", ".mp4", ".mov", ".map", ".min.js"]);
const MAX_BYTES = 200_000;
const PREVIEW_LINES = 40;
const PREVIEW_CHARS = 1500;

export type FileEntry = { path: string; preview: string };

export async function collectFiles(root: string, maxFiles: number): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  async function visit(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith(".") && e.name !== ".env.example") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await visit(full);
      } else if (e.isFile() && !SKIP_EXT.has(extname(e.name))) {
        if ((await stat(full)).size > MAX_BYTES) continue;
        const text = await readFile(full, "utf8").catch(() => "");
        if (!text || text.includes("\0")) continue;
        const preview = text.split("\n").slice(0, PREVIEW_LINES).join("\n").slice(0, PREVIEW_CHARS);
        out.push({ path: relative(root, full), preview });
      }
    }
  }
  await visit(root);
  return out;
}
