export function projectDirectoryFlag(
  values: readonly string[],
): string | undefined {
  const index = values.indexOf("--project-dir");
  if (index >= 0) return values[index + 1];
  const inline = values.find((value) => value.startsWith("--project-dir="));
  return inline?.slice("--project-dir=".length);
}

export function readFlag(
  values: readonly string[],
  name: string,
  fallback: string | null = null,
): string | null {
  const index = values.indexOf(name);
  return index >= 0 ? (values[index + 1] ?? "true") : fallback;
}
