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
  deletedAt: null,
  lineage: { relationshipToParent: null },
  status: "completed",
  activityRunStatus: null,
  pendingRuntimeRequest: null,
  pendingBackgroundTasks: [],
  hasActionableProposedPlan: false,
  ...overrides,
})

test("lists unsettled threads that wait on me, most urgent first", () => {
  expect(
    attention(
      [
        thread({ title: "done" }),
        thread({ title: "idle", status: "idle" }),
        thread({ title: "pinned done", pinnedAt: "2026-09-26T11:00:00Z" }),
        thread({
          title: "pinned question",
          pinnedAt: "2026-09-26T11:00:00Z",
          pendingRuntimeRequest: { kind: "user_input" },
        }),
        thread({ title: "running", activityRunStatus: "running" }),
        thread({
          title: "subagent running",
          pendingBackgroundTasks: [{ kind: "subagent" }],
        }),
        thread({
          title: "approval",
          pendingRuntimeRequest: { kind: "command_execution_approval" },
        }),
        thread({
          title: "auth refresh",
          activityRunStatus: "waiting",
          pendingRuntimeRequest: { kind: "auth_refresh" },
        }),
        thread({ title: "plan", hasActionableProposedPlan: true }),
        thread({ title: "settled", settledAt: "2026-09-26T11:00:00Z" }),
        thread({ title: "archived", archivedAt: "2026-09-26T11:00:00Z" }),
        thread({ title: "snoozed", snoozedUntil: "2026-09-26T13:00:00Z" }),
        thread({
          title: "subagent",
          lineage: { relationshipToParent: "subagent" },
        }),
        thread({ title: "failed", status: "failed" }),
      ],
      now,
    ),
  ).toEqual([
    { title: "approval", reason: "approval" },
    { title: "pinned question", reason: "question" },
    { title: "plan", reason: "plan" },
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
