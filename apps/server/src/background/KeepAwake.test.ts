import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as KeepAwake from "./KeepAwake.ts";

describe("KeepAwake hold rules", () => {
  // Fails if a manual hold stops depending on the hold alone, or `agents` outlives the last run.
  it("holds for `on` while idle, and for `agents` only while a run is active", () => {
    expect(KeepAwake.wantsHold({ auto: false, hold: "on" }, false)).toBe(true);
    expect(KeepAwake.wantsHold({ auto: false, hold: "agents" }, true)).toBe(true);
    expect(KeepAwake.wantsHold({ auto: false, hold: "agents" }, false)).toBe(false);
    expect(KeepAwake.wantsHold({ auto: false, hold: "off" }, true)).toBe(false);
    expect(KeepAwake.wantsHold({ auto: true, hold: "off" }, true)).toBe(true);
    expect(KeepAwake.clearsAgentsHold({ auto: true, hold: "agents" }, false)).toBe(true);
    expect(KeepAwake.clearsAgentsHold({ auto: true, hold: "agents" }, true)).toBe(false);
    expect(KeepAwake.clearsAgentsHold({ auto: true, hold: "on" }, false)).toBe(false);
  });
});

describe("KeepAwake.holdWhileWanted", () => {
  it.effect("keeps one hold across a gap shorter than the grace and releases after it", () =>
    Effect.gen(function* () {
      const wanted = yield* Queue.unbounded<boolean>();
      const transitions = yield* Queue.unbounded<"held" | "released">();
      const hold = Effect.acquireRelease(Queue.offer(transitions, "held"), () =>
        Queue.offer(transitions, "released"),
      ).pipe(Effect.andThen(Effect.never), Effect.scoped);
      yield* KeepAwake.holdWhileWanted(Stream.fromQueue(wanted), hold, "60 seconds").pipe(
        Effect.forkScoped,
      );

      yield* Queue.offer(wanted, true);
      expect(yield* Queue.take(transitions)).toBe("held");

      yield* Queue.offer(wanted, false);
      yield* TestClock.adjust("30 seconds");
      yield* Queue.offer(wanted, true);
      yield* TestClock.adjust("120 seconds");
      expect(yield* Queue.size(transitions)).toBe(0);

      yield* Queue.offer(wanted, false);
      yield* TestClock.adjust("120 seconds");
      expect(yield* Queue.take(transitions)).toBe("released");
      expect(yield* Queue.size(transitions)).toBe(0);
    }),
  );
});
