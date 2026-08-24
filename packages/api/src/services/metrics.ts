export class Metrics {
  values = new Map<string, number>();

  increment(name: string, value = 1): number {
    const next = (this.values.get(name) ?? 0) + value;
    this.values.set(name, next);
    return next;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values);
  }
}
