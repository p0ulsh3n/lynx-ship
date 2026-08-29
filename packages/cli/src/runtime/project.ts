import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ProjectRootOptions {
  explicitDirectory?: string;
  environmentDirectory?: string;
}

export function findProjectRoot(
  start: string,
  options: ProjectRootOptions = {},
): string {
  const explicit = options.explicitDirectory ?? options.environmentDirectory;
  if (explicit) return resolve(explicit);

  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "lynxship.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function findLockfile(
  rootDirectory: string,
): Promise<string | null> {
  let current = resolve(rootDirectory);
  while (true) {
    for (const file of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"])
      if (await exists(join(current, file))) return join(current, file);
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
