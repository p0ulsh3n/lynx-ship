// Rspeedy's QR plugin accepts custom schemas, so a dev URL is not always HTTP.
const URL_PATTERN = /[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/gi;

function cleanUrl(value: string): string {
  return value.replace(/[),.;!?]+$/u, "");
}

export function extractDevServerUrl(line: string): string | undefined {
  const urls = (line.match(URL_PATTERN) ?? []).map(cleanUrl);
  return (
    urls.find((url) => url.includes("fullscreen=true")) ??
    urls.find((url) => url.includes(".lynx.bundle")) ??
    urls[0]
  );
}

export function shouldPrintDevServerQr(line: string): boolean {
  return /(?:default:|fullscreen|\bready\b|\blynx\b)/iu.test(line);
}
