import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test"
import type { Effects } from "@/module"
import { calendar } from "@/modules/calendar"

process.env.TZ = "Asia/Tokyo"

afterEach(() => {
  mock.restore()
  setSystemTime()
})

const module = calendar({ clientId: "client", clientSecret: "secret" }, [
  { label: "personal", refreshToken: "refresh-personal" },
  { label: "work", refreshToken: "refresh-work" },
])

const event = (summary: string, start: object, attendees?: object[]) => ({
  summary,
  htmlLink: `https://www.google.com/calendar/event?eid=${summary}`,
  start,
  ...(attendees && { attendees }),
})

// Each account's access token is its refresh token, so events route by account.
const stubFetch = (calendars: Record<string, object>) =>
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname === "/token")
          return Response.json({
            access_token: new URLSearchParams(String(init?.body)).get(
              "refresh_token",
            ),
          })
        const token = new Headers(init?.headers).get("authorization")
        const body = calendars[token?.replace("Bearer ", "") ?? ""]
        return body ? Response.json(body) : new Response(null, { status: 401 })
      },
      { preconnect: fetch.preconnect },
    ),
  )

const fetchEvents = () => {
  if (!("fetch" in module)) throw new Error("calendar must be scheduled")
  return module.fetch()
}

test("merges timed, accepted events across accounts by start", async () => {
  setSystemTime(new Date("2026-09-27T10:00:00+09:00"))
  stubFetch({
    "refresh-personal": {
      summary: "me@gmail.com",
      items: [
        event("holiday", { date: "2026-09-27" }),
        event("dentist", { dateTime: "2026-09-27T10:45:00+09:00" }),
      ],
    },
    "refresh-work": {
      summary: "me@crefil.com",
      items: [
        event("standup", { dateTime: "2026-09-27T09:55:00+09:00" }),
        event("skipped", { dateTime: "2026-09-27T10:30:00+09:00" }, [
          { self: true, responseStatus: "declined" },
        ]),
      ],
    },
  })

  const events = await fetchEvents()
  expect(events).toEqual([
    {
      title: "standup",
      start: Date.parse("2026-09-27T09:55:00+09:00"),
      url: "https://www.google.com/calendar/event?eid=standup&authuser=me%40crefil.com",
    },
    {
      title: "dentist",
      start: Date.parse("2026-09-27T10:45:00+09:00"),
      url: "https://www.google.com/calendar/event?eid=dentist&authuser=me%40gmail.com",
    },
  ])
  expect(module.render(events)).toContain("dentist")

  const open = mock(async (_url: string) => {})
  await module.tap?.({ ssh: { open } } as unknown as Effects, events)
  expect(open).toHaveBeenCalledWith(events[0]?.url)
})

test("lists the first three events and counts the rest", () => {
  const start = Date.now()
  const events = ["a", "b", "c", "d", "e"].map((title) => ({
    title: `event-${title}`,
    start,
    url: "https://example.com/",
  }))
  const html = String(module.render(events))
  expect(html).toContain("event-c")
  expect(html).not.toContain("event-d")
  expect(html).toContain("他2件")
})

test("shows from an hour before the start until 10 minutes after", () => {
  const start = Date.parse("2026-09-27T10:00:00+09:00")
  const events = [{ title: "sync", start, url: "https://example.com/" }]
  const visibleAt = (minutes: number) =>
    module.visible?.(events, new Date(start + minutes * 60_000))
  expect(visibleAt(-61)).toBe(false)
  expect(visibleAt(-60)).toBe(true)
  expect(visibleAt(9)).toBe(true)
  expect(visibleAt(10)).toBe(false)
  expect(module.visible?.([], new Date(start))).toBe(false)
})

test("a failing account fails the fetch", async () => {
  stubFetch({ "refresh-personal": { summary: "me@gmail.com", items: [] } })
  expect(fetchEvents()).rejects.toThrow("work responded 401")
})
