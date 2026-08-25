const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;

function cleanUrl(value: string): string {
  return value.replace(/[),.;!?]+$/u, "");
}

export function extractDevServerUrl(line: string): string | undefined {
  const urls = (line.match(URL_PATTERN) ?? []).map(cleanUrl);
  return (
    urls.find((url) => url.includes("fullscreen=true")) ??
    urls.find((url) => url.includes(".lynx.bundle"))
  );
}

export function shouldPrintDevServerQr(line: string): boolean {
  return /(?:default:|fullscreen=true|\bready\b)/iu.test(line);
}
