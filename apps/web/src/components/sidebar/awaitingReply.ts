import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import type { SidebarThreadSummary } from "../../types";
import type { SidebarThreadStatus } from "../Sidebar.logic";

const MAX_HANDLED = 500;

/**
 * A finished turn the user has looked at but not answered. A new turn or "mark handled" ends it.
 * Handled marks are per device and keyed by the run's completion time, so the next turn shows again.
 */
export function isAwaitingReply(input: {
  readonly status: SidebarThreadStatus;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
  readonly isSettled: boolean;
  readonly latestRun: SidebarThreadSummary["latestRun"];
  readonly handledCompletedAt: string | undefined;
}): boolean {
  const { latestRun } = input;
  if (input.status !== "ready" || input.isUnread || input.isWoke || input.isSettled) return false;
  if (latestRun?.status !== "completed" || !latestRun.completedAt) return false;
  return input.handledCompletedAt !== latestRun.completedAt;
}

interface AwaitingReplyState {
  handled: Record<string, string>;
  markHandled: (threadKey: string, completedAt: string) => void;
}

export const useAwaitingReplyStore = create<AwaitingReplyState>()(
  persist(
    (set) => ({
      handled: {},
      markHandled: (threadKey, completedAt) =>
        set((state) => {
          const { [threadKey]: _previous, ...rest } = state.handled;
          const entries = Object.entries(rest).slice(-(MAX_HANDLED - 1));
          return { handled: { ...Object.fromEntries(entries), [threadKey]: completedAt } };
        }),
    }),
    {
      name: "t3code:awaiting-reply-handled:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      partialize: ({ handled }) => ({ handled }),
    },
  ),
);
