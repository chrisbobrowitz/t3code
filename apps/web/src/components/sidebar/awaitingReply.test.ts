import { describe, expect, it } from "vite-plus/test";

import { isAwaitingReply } from "./awaitingReply";

const completedAt = "2026-11-20T10:00:00.000Z";
const base = {
  status: "ready" as const,
  isUnread: false,
  isWoke: false,
  isSettled: false,
  latestRun: { status: "completed", completedAt } as Parameters<
    typeof isAwaitingReply
  >[0]["latestRun"],
  handledCompletedAt: undefined,
};

describe("isAwaitingReply", () => {
  // Fails if a seen, unanswered turn stops showing, or a handled or newer state keeps showing it.
  const cases: ReadonlyArray<
    readonly [string, Partial<Parameters<typeof isAwaitingReply>[0]>, boolean]
  > = [
    ["a seen, finished turn", {}, true],
    ["the next turn after a handled one", { handledCompletedAt: "2026-11-19T10:00:00.000Z" }, true],
    ["a handled turn", { handledCompletedAt: completedAt }, false],
    ["an unseen turn, which shows Done", { isUnread: true }, false],
    ["a working thread", { status: "working" }, false],
    ["a settled thread", { isSettled: true }, false],
    ["an interrupted run", { latestRun: { ...base.latestRun!, status: "interrupted" } }, false],
  ];
  it.each(cases)("%s", (_name, overrides, expected) => {
    expect(isAwaitingReply({ ...base, ...overrides })).toBe(expected);
  });
});
