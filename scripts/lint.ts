import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (
      entry.isDirectory() &&
      entry.name !== "node_modules" &&
      entry.name !== "dist"
    )
      result.push(...(await files(path)));
    else if (entry.isFile() && /\.(mjs|ts|tsx)$/.test(entry.name))
      result.push(path);
  }
  return result;
}

const roots = ["packages", "scripts", "test"];
const targets = (
  await Promise.all(
    roots.map(async (root) => {
      try {
        return await files(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    }),
  )
).flat();
const failures: string[] = [];
for (const file of targets) {
  const text = await readFile(file, "utf8");
  if (!text.endsWith("\n")) failures.push(`${file}: missing final newline`);
  if (/\@ts-(ignore|nocheck)/.test(text))
    failures.push(`${file}: TypeScript suppression is not allowed`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`lint: ${targets.length} source files checked`);
