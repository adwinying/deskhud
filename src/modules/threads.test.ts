import { expect, test } from "bun:test"
import { attention, threads } from "@/modules/threads"

const now = Date.parse("2026-09-26T12:00:00Z")

const thread = (overrides: object) => ({
  id: crypto.randomUUID(),
  title: "t",
  archivedAt: null,
  settledAt: null,
  snoozedUntil: null,
  pinnedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  latestTurn: { state: "completed" },
  session: { status: "ready" },
  ...overrides,
})

test("lists unsettled threads that wait on me, most urgent first", () => {
  expect(
    attention(
      [
        thread({ title: "done" }),
        thread({ title: "pinned done", pinnedAt: "2026-09-26T11:00:00Z" }),
        thread({
          title: "pinned question",
          pinnedAt: "2026-09-26T11:00:00Z",
          hasPendingUserInput: true,
        }),
        thread({ title: "running", session: { status: "running" } }),
        thread({ title: "approval", hasPendingApprovals: true }),
        thread({ title: "settled", settledAt: "2026-09-26T11:00:00Z" }),
        thread({ title: "archived", archivedAt: "2026-09-26T11:00:00Z" }),
        thread({ title: "snoozed", snoozedUntil: "2026-09-26T13:00:00Z" }),
        thread({ title: "failed", latestTurn: { state: "error" } }),
      ],
      now,
    ),
  ).toEqual([
    { title: "approval", reason: "approval" },
    { title: "pinned question", reason: "question" },
    { title: "failed", reason: "error" },
    { title: "done", reason: "done" },
  ])
})

test("escapes thread titles", async () => {
  const module = threads([
    { label: "m", url: "https://t3.example", token: "x" },
  ])
  const html = await module.render([
    { title: "<b>x</b>", reason: "done", machine: "m" },
  ])
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
})
