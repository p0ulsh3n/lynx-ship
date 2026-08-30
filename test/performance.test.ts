import assert from "node:assert/strict";
import test from "node:test";
import {
  PerformanceError,
  compareBenchmarkStats,
  createPerformanceCollector,
  runPerformanceBenchmark,
} from "@lynxship/performance";

test("performance benchmark reports bounded cold/warm p50 and p95 values", async () => {
  const result = await runPerformanceBenchmark({
    iterations: 3,
    warmupIterations: 1,
    run: async (phase, iteration) => ({
      firstScreenMs: phase === "cold" ? 100 + iteration : 40 + iteration,
      interactionMs: phase === "cold" ? 12 : 6,
      bundleBytes: 1024,
    }),
  });
  assert.equal(result.samples.length, 6);
  assert.equal(result.firstScreen.cold.p50, 101);
  assert.equal(result.firstScreen.warm.p95, 42);
  assert.equal(result.interaction.cold?.p95, 12);
  assert.equal(
    compareBenchmarkStats(
      "firstScreenMs",
      result.firstScreen.cold,
      result.firstScreen.warm,
    ).winner,
    "right",
  );
});

test("performance benchmark rejects invalid samples and aborts safely", async () => {
  await assert.rejects(
    () => runPerformanceBenchmark({ run: async () => ({ firstScreenMs: -1 }) }),
    (error: unknown) =>
      error instanceof PerformanceError &&
      error.code === "PERFORMANCE_BENCHMARK_INVALID",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      runPerformanceBenchmark({
        signal: controller.signal,
        run: async () => ({ firstScreenMs: 1 }),
      }),
    (error: unknown) =>
      error instanceof PerformanceError &&
      error.code === "PERFORMANCE_BENCHMARK_ABORTED",
  );
});

test("performance collector records bounded official-source entries and marks", async () => {
  let emit!: (entry: {
    entryType: "metric";
    name: string;
    startTime: number;
    duration: number;
  }) => void;
  const flushed: string[] = [];
  const collector = createPerformanceCollector({
    maxEntries: 2,
    source: {
      start(callback) {
        emit = callback;
      },
    },
    sink: {
      write(entries) {
        flushed.push(...entries.map((entry) => entry.name));
      },
    },
    now: (() => {
      let time = 10;
      return () => (time += 5);
    })(),
  });
  collector.start();
  collector.mark("start");
  emit({ entryType: "metric", name: "fcp", startTime: 20, duration: 4 });
  collector.measure("screen", "start");
  assert.deepEqual(
    collector.snapshot().map((entry) => entry.name),
    ["fcp", "screen"],
  );
  await collector.flush();
  assert.deepEqual(flushed, ["fcp", "screen"]);
  assert.deepEqual(collector.snapshot(), []);
});

test("performance collector rejects bad entries, missing marks and sink failures preserve data", async () => {
  const collector = createPerformanceCollector({ maxEntries: 1 });
  collector.start();
  assert.throws(
    () =>
      collector.record({
        entryType: "metric",
        name: "",
        startTime: 0,
        duration: 0,
      }),
    { code: "PERFORMANCE_INVALID_ENTRY" },
  );
  assert.throws(() => collector.measure("x", "missing"), {
    code: "PERFORMANCE_MARK_NOT_FOUND",
  });
  collector.mark("ok");
  const failing = createPerformanceCollector({
    sink: {
      write: async () => {
        throw new Error("offline");
      },
    },
  });
  failing.start();
  failing.mark("pending");
  await assert.rejects(() => failing.flush(), /offline/);
  assert.equal(failing.snapshot().length, 1);
  collector.stop();
  assert.throws(
    () => collector.mark("after-stop"),
    (error: unknown) =>
      error instanceof PerformanceError &&
      error.code === "PERFORMANCE_INVALID_STATE",
  );
});

test("performance collector removes evicted marks and stops after source failure", () => {
  const collector = createPerformanceCollector({ maxEntries: 1 });
  collector.start();
  collector.mark("old");
  collector.mark("new");
  assert.throws(() => collector.measure("stale", "old"), {
    code: "PERFORMANCE_MARK_NOT_FOUND",
  });

  const failed = createPerformanceCollector({
    source: {
      start() {
        throw new Error("source unavailable");
      },
    },
  });
  assert.throws(() => failed.start(), /source unavailable/);
  assert.equal(failed.state, "stopped");
});
