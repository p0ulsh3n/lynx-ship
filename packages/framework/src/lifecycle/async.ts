export class ExclusiveOperationQueue {
  private tail = Promise.resolve();

  public run<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(operation).finally(release);
  }
}

export interface WaitForPromiseOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onAbort: () => Error;
  readonly onTimeout: () => Error;
}

export function waitForPromise<T>(
  promise: Promise<T>,
  options: WaitForPromiseOptions,
): Promise<T> {
  if (options.signal === undefined && options.timeoutMs === undefined)
    return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => finish(() => reject(options.onAbort()));
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.timeoutMs !== undefined)
      timer = setTimeout(
        () => finish(() => reject(options.onTimeout())),
        options.timeoutMs,
      );
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
