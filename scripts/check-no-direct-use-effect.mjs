import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "apps/web/src");
const ALLOWED_FILES = new Set(["apps/web/src/lib/useMountEffect.ts"]);
const IGNORED_DIRS = new Set(["apps/web/src/components/ui"]);
const FILE_RE = /\.(ts|tsx)$/;
const DIRECT_USE_EFFECT_RE = /\b(?:React\.)?useEffect\s*\(/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(ROOT, path);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(rel)) yield* walk(path);
      continue;
    }
    if (entry.isFile() && FILE_RE.test(entry.name)) yield path;
  }
}

const violations = [];

for await (const path of walk(SRC)) {
  const rel = relative(ROOT, path);
  if (ALLOWED_FILES.has(rel)) continue;
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (DIRECT_USE_EFFECT_RE.test(line)) {
      violations.push(`${rel}:${index + 1}: direct useEffect is not allowed`);
    }
  });
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
