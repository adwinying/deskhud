import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { PushSource } from "@/module"
import { attention, threads, watchEnvironments } from "@/modules/threads"

afterEach(() => mock.restore())

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

// Hands the test each environment's Source, as `watchThreads` would push to it.
const watched = (...labels: string[]) => {
  const sources = new Map<string, PushSource<unknown[]>>()
  const module = { next: mock(), fail: mock() }
  watchEnvironments(
    labels.map((label) => ({ label, url: "", token: "" })),
    module,
    ({ label }, source) => sources.set(label, source),
  )
  const source = (label: string) => {
    const found = sources.get(label)
    if (!found) throw new Error(`${label} must be watched`)
    return found
  }
  return { module, source }
}

const closed = new Error("T3 Code websocket closed (1002)")

test("logs a dropped environment once per outage, not per retry", () => {
  const error = spyOn(console, "error").mockImplementation(() => {})
  const log = spyOn(console, "log").mockImplementation(() => {})
  const { source } = watched("hive", "mayonaca")

  source("hive").next([])
  for (let retry = 0; retry < 3; retry++) source("hive").fail(closed)
  expect(error).toHaveBeenCalledTimes(1)

  source("hive").next([])
  source("hive").next([])
  expect(log).toHaveBeenCalledTimes(1)

  source("hive").fail(closed)
  expect(error).toHaveBeenCalledTimes(2)
})

test("logs an environment that never connected once, then its recovery", () => {
  const error = spyOn(console, "error").mockImplementation(() => {})
  const log = spyOn(console, "log").mockImplementation(() => {})
  const { source } = watched("hive", "mayonaca")

  for (let retry = 0; retry < 3; retry++) source("mayonaca").fail(closed)
  source("mayonaca").next([])
  expect(error).toHaveBeenCalledTimes(1)
  expect(log).toHaveBeenCalledTimes(1)
})

test("goes Stale once per outage when every environment is down", () => {
  const error = spyOn(console, "error").mockImplementation(() => {})
  spyOn(console, "log").mockImplementation(() => {})
  const { module, source } = watched("hive", "mayonaca")
  const outage = () => {
    for (let retry = 0; retry < 3; retry++) {
      source("hive").fail(closed)
      source("mayonaca").fail(closed)
    }
  }

  outage()
  expect(module.fail).toHaveBeenCalledTimes(1)
  // The last environment down still gets its own labeled line.
  expect(error).toHaveBeenCalledTimes(2)

  source("hive").next([])
  outage()
  expect(module.fail).toHaveBeenCalledTimes(2)
})
