export interface RequestOptions {
  fetchImpl?: typeof fetch;
  retries?: number;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RequestOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      if (response.ok || (response.status < 500 && response.status !== 429))
        return response;
      lastError = new Error("HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await delay(250 * 2 ** attempt);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Request failed after retries");
}

export async function throwResponseError(
  response: Response,
  provider: string,
): Promise<never> {
  let detail = "";
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      errors?: Array<{ message?: string }>;
      message?: string;
    };
    detail =
      body.error?.message ?? body.errors?.[0]?.message ?? body.message ?? "";
  } catch {
    detail = await response.text().catch(() => "");
  }
  throw new Error(
    provider +
      " request failed (" +
      response.status +
      ")" +
      (detail ? ": " + detail : ""),
  );
}

export async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  provider: string,
  options?: RequestOptions,
): Promise<T> {
  const response = await fetchWithRetry(url, init, options);
  if (!response.ok) await throwResponseError(response, provider);
  return (await response.json()) as T;
}
