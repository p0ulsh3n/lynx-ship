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

const prometheusName = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

function escapePrometheusLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}

/**
 * Render the internal metric-key format without allowing label data to break
 * the Prometheus text exposition format.
 *
 * Metric keys use `name|label=value|label=value`. The first `=` in a label is
 * the separator so values may themselves contain `=`. Malformed keys are
 * ignored because emitting invalid exposition is worse than omitting an
 * optional diagnostic metric.
 */
export function renderPrometheusMetrics(
  snapshot: Record<string, number>,
  prefix = "lynxship_",
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(snapshot)) {
    const [name, ...labelParts] = key.split("|");
    if (!name || !prometheusName.test(name) || !Number.isFinite(value))
      continue;

    const labels: string[] = [];
    let malformed = false;
    for (const label of labelParts) {
      const separator = label.indexOf("=");
      if (separator <= 0) {
        malformed = true;
        break;
      }
      const labelName = label.slice(0, separator);
      const labelValue = label.slice(separator + 1);
      if (!prometheusName.test(labelName)) {
        malformed = true;
        break;
      }
      labels.push(`${labelName}="${escapePrometheusLabelValue(labelValue)}"`);
    }
    if (malformed) continue;

    lines.push(
      `${prefix}${name}${labels.length ? `{${labels.join(",")}}` : ""} ${value}`,
    );
  }

  return `${lines.join("\n")}\n`;
}
