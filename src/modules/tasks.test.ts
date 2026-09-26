import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test"
import { tasks } from "@/modules/tasks"

// "Today" is the Hub's local day, which the image pins to Asia/Tokyo.
process.env.TZ = "Asia/Tokyo"

afterEach(() => {
  mock.restore()
  setSystemTime()
})

const stubFetch = (responses: Record<string, Response>) => {
  const bodies: Record<string, unknown> = {}
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname
        bodies[path] = JSON.parse(String(init?.body))
        return responses[path] ?? new Response(null, { status: 404 })
      },
      { preconnect: fetch.preconnect },
    ),
  )
  return bodies
}

const fetchTasks = () => {
  const module = tasks("token")
  if (!("fetch" in module)) throw new Error("tasks must be scheduled")
  return module.fetch()
}

test("counts open tasks and today's dated completions", async () => {
  setSystemTime(new Date("2026-09-26T12:00:00+09:00"))
  const bodies = stubFetch({
    "/open/v1/task/filter": Response.json([
      { startDate: "2026-09-26T00:00:00.000+0000" },
      { startDate: "2026-09-20T00:00:00.000+0000" },
    ]),
    "/open/v1/task/completed": Response.json([
      { startDate: "2026-09-26T00:00:00.000+0000" },
      // Undated, or completed ahead of a later day: not in the Today view.
      {},
      { startDate: "2026-09-28T00:00:00.000+0000" },
    ]),
  })

  expect(await fetchTasks()).toEqual({ remaining: 2, done: 1 })
  expect(bodies["/open/v1/task/filter"]).toEqual({
    endDate: "2026-09-26T23:59:59.999+0900",
    status: [0],
  })
  expect(bodies["/open/v1/task/completed"]).toEqual({
    startDate: "2026-09-26T00:00:00.000+0900",
    endDate: "2026-09-26T12:00:00.000+0900",
  })
})

test("a rejected token fails the fetch", async () => {
  stubFetch({
    "/open/v1/task/filter": new Response(null, { status: 401 }),
    "/open/v1/task/completed": Response.json([]),
  })
  expect(fetchTasks()).rejects.toThrow("401")
})
