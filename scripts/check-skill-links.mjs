import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const skillsRoot = join(root, ".agents", "skills");
const urlPattern = /https?:\/\/[^\s)<>'"]+/g;
const trimTrailing = /[.,;:!?]+$/;
const timeoutMs = 15_000;
const concurrency = 6;

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }

  return files;
}

function sourceLinks(contents) {
  return [...contents.matchAll(urlPattern)].map((match) =>
    match[0].replace(trimTrailing, ""),
  );
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "lynxship-skill-link-audit/1.0" },
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "lynxship-skill-link-audit/1.0" },
      });
    }

    return { url, status: response.status, ok: response.status < 400 };
  } catch (error) {
    return {
      url,
      status: "error",
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const files = await markdownFiles(skillsRoot);
const links = new Map();

for (const file of files) {
  const contents = await readFile(file, "utf8");
  for (const url of sourceLinks(contents)) {
    const locations = links.get(url) ?? [];
    locations.push(relative(root, file));
    links.set(url, locations);
  }
}

const pending = [...links.keys()];
const results = [];

async function worker() {
  while (pending.length > 0) {
    const url = pending.shift();
    if (url) results.push(await checkUrl(url));
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, pending.length) }, worker),
);

results.sort((left, right) => left.url.localeCompare(right.url));
for (const result of results) {
  const location = links.get(result.url)?.join(", ") ?? "unknown";
  const detail = result.reason ? ` ${result.reason}` : "";
  console.log(
    `${result.ok ? "PASS" : "FAIL"} ${result.status} ${result.url} (${location})${detail}`,
  );
}

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} skill source link(s) failed.`);
  process.exitCode = 1;
}
