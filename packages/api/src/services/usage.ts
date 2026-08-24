import { assert, type Platform } from "@lynxship/contracts";
import { IdGenerator } from "@lynxship/storage";

export const PLAN_LIMITS = {
  free: { android_build_minutes: 30, macos_ios_build_minutes: 10 },
  indie: { android_build_minutes: 300, macos_ios_build_minutes: 120 },
} as const;

export type UsageMetric = keyof typeof PLAN_LIMITS.free;

export interface UsageRecord {
  id: string;
  organizationId: string;
  platform: Platform;
  minutes: number;
  source: string;
  kind: string;
  createdAt: string;
}

export class UsageLedger {
  records: UsageRecord[] = [];

  record(input: {
    organizationId: string;
    platform: Platform;
    minutes: number;
    source?: string;
    kind?: string;
  }): UsageRecord {
    assert(
      input.minutes >= 0,
      "USAGE_INVALID",
      "Usage minutes cannot be negative",
    );
    const record: UsageRecord = {
      id: IdGenerator.create("usage"),
      organizationId: input.organizationId,
      platform: input.platform,
      minutes: input.minutes,
      source: input.source ?? "managed",
      kind: input.kind ?? "build",
      createdAt: new Date().toISOString(),
    };
    this.records.push(Object.freeze(record));
    return record;
  }

  total(organizationId: string, platform: Platform): number {
    return this.records
      .filter(
        (record) =>
          record.organizationId === organizationId &&
          record.platform === platform,
      )
      .reduce((sum, record) => sum + record.minutes, 0);
  }

  list(organizationId?: string): UsageRecord[] {
    return this.records.filter(
      (record) => !organizationId || record.organizationId === organizationId,
    );
  }
}

export class LimitPolicy {
  constructor(readonly plan: keyof typeof PLAN_LIMITS = "free") {
    assert(PLAN_LIMITS[plan], "PLAN_UNKNOWN", `Unknown plan: ${plan}`);
  }

  check(input: { metric: UsageMetric; used?: number; requested?: number }): {
    allowed: boolean;
    limit: number | null;
    remaining: number | null;
  } {
    const limit = PLAN_LIMITS[this.plan][input.metric];
    const used = input.used ?? 0;
    const requested = input.requested ?? 0;
    return {
      allowed: used + requested <= limit,
      limit,
      remaining: Math.max(0, limit - used),
    };
  }
}
