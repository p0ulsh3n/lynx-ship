# @lynxship/performance

Bounded performance collection for Lynx hosts. Lynx adapters can forward the
official asynchronous `metric`, `pipeline`, `resource` and `init` entries to a
collector; application code can add portable marks and measures. The package
does not call Lynx globals, update UI from a performance callback, or assume a
specific Android, iOS, HarmonyOS, web or desktop API.

```ts
import { createPerformanceCollector } from "@lynxship/performance";

const performance = createPerformanceCollector({
  source: lynxPerformanceSource,
  maxEntries: 2000,
  sink: { write: (entries) => telemetry.write(entries) },
});
performance.start();
performance.mark("screen-requested");
```

Entries are validated, copied, bounded and exported only after a successful
sink write. A source adapter must register before bundle loading and must keep
UI work out of its asynchronous callback, matching Lynx's performance API
contract. The source is responsible for converting the native Lynx callback
shape into this stable portable shape.

## Reproducible benchmarks

`runPerformanceBenchmark` provides a platform-neutral harness for comparing
the same bundle and device matrix across hosts such as LynxShip and Sparkling.
The adapter performs the real load and interaction, while the harness runs
bounded cold/warm iterations and reports p50/p95 first-screen and interaction
latency. `compareBenchmarkStats` treats differences below the configured
threshold as a tie, so the result cannot claim a performance win from noise.

Use the same Lynx release, bundle, device model, build mode, network policy,
thermal state and iteration counts for both hosts. The package deliberately
does not declare a winner without those measurements.
