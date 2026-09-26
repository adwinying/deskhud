import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test"
import { sleep } from "@/modules/sleep"

// "Today" is the Hub's local day, which the image pins to Asia/Tokyo.
process.env.TZ = "Asia/Tokyo"

afterEach(() => {
  mock.restore()
  setSystemTime()
})

const module = sleep({
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
})

const session = (
  endTime: string,
  metadata: object,
  minutesAsleep?: string,
) => ({
  sleep: {
    interval: { startTime: endTime, endTime },
    type: "STAGES",
    metadata: { stagesStatus: "SUCCEEDED", processed: true, ...metadata },
    ...(minutesAsleep && { summary: { minutesAsleep, minutesAwake: "30" } }),
  },
})

const hrv = (day: number, ms: number) => ({
  dailyHeartRateVariability: {
    date: { year: 2026, month: 9, day },
    averageHeartRateVariabilityMilliseconds: ms,
  },
})

const token = "/token"
const sleeps = "/v4/users/me/dataTypes/sleep/dataPoints"
const hrvs = "/v4/users/me/dataTypes/daily-heart-rate-variability/dataPoints"

const stubFetch = (responses: Record<string, Response>) => {
  const urls: URL[] = []
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        urls.push(url)
        return responses[url.pathname] ?? new Response(null, { status: 404 })
      },
      { preconnect: fetch.preconnect },
    ),
  )
  return urls
}

const fetchNight = () => {
  if (!("fetch" in module)) throw new Error("sleep must be scheduled")
  return module.fetch()
}

test("compares this morning's main sleep and HRV with the previous", async () => {
  setSystemTime(new Date("2026-09-26T15:00:00+09:00"))
  const urls = stubFetch({
    [token]: Response.json({ access_token: "access" }),
    [sleeps]: Response.json({
      dataPoints: [
        session("2026-09-26T05:45:00Z", { nap: true }, "112"),
        // Not yet processed: no summary.
        session("2026-09-26T05:00:00Z", { mainSleep: true }),
        session("2026-09-25T22:30:00Z", { mainSleep: true }, "400"),
        session("2026-09-24T22:10:00Z", { mainSleep: true }, "415"),
      ],
    }),
    [hrvs]: Response.json({
      dataPoints: [hrv(26, 30.5), hrv(25, 31)],
    }),
  })

  const night = await fetchNight()
  expect(night).toEqual({
    date: "2026-09-26",
    wokeAt: Date.parse("2026-09-25T22:30:00Z"),
    minutes: 400,
    minutesChange: -15,
    hrv: 30.5,
    hrvChange: -0.5,
  })
  expect(urls.map((url) => url.searchParams.get("filter"))).toContain(
    'sleep.interval.civil_end_time >= "2026-09-23"',
  )
  expect(module.visible?.(night, new Date())).toBe(true)
  expect(module.visible?.(night, new Date("2026-09-27T07:00:00+09:00"))).toBe(
    false,
  )
})

test("priority sinks over the 12 hours after waking", () => {
  const wokeAt = Date.parse("2026-09-26T07:00:00+09:00")
  const night = {
    date: "2026-09-26",
    wokeAt,
    minutes: 420,
    minutesChange: undefined,
    hrv: undefined,
    hrvChange: undefined,
  }
  const at = (hours: number) =>
    module.effectivePriority?.(night, new Date(wokeAt + hours * 3_600_000))
  expect(at(0)).toBe(44)
  expect(at(6)).toBe(36.5)
  expect(at(12)).toBe(29)
  expect(at(16)).toBe(29)
})

test("no main sleep yet yields nothing to show", async () => {
  stubFetch({
    [token]: Response.json({ access_token: "access" }),
    [sleeps]: Response.json({}),
    [hrvs]: Response.json({}),
  })
  const night = await fetchNight()
  expect(night).toBeUndefined()
  expect(module.visible?.(night, new Date())).toBe(false)
})

test("a revoked refresh token fails the fetch", async () => {
  stubFetch({ [token]: new Response(null, { status: 400 }) })
  expect(fetchNight()).rejects.toThrow("400")
})
