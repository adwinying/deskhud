import { afterEach, expect, mock, setSystemTime, spyOn, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Module } from "@/module"
import { claudeUsage, codexUsage } from "@/modules/usage"

const now = Date.parse("2026-09-26T12:00:00Z")
const inHour = now / 1000 + 3600
const inDays = now / 1000 + 3 * 86_400

const claudeHeaders = (fiveHour: string, status = "allowed") => ({
  "anthropic-ratelimit-unified-status": status,
  "anthropic-ratelimit-unified-reset": String(inHour),
  "anthropic-ratelimit-unified-5h-utilization": fiveHour,
  "anthropic-ratelimit-unified-5h-reset": String(inHour),
  "anthropic-ratelimit-unified-5h-status": "allowed",
  "anthropic-ratelimit-unified-7d-utilization": "0.3",
  "anthropic-ratelimit-unified-7d-reset": String(inDays),
  "anthropic-ratelimit-unified-7d-status": "allowed",
})

const wham = {
  plan_type: "plus",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 25,
      limit_window_seconds: 5 * 3600,
      reset_at: inHour,
    },
    secondary_window: {
      used_percent: 60,
      limit_window_seconds: 7 * 86_400,
      reset_at: inDays,
    },
  },
}

type Handler = (url: string, init?: RequestInit) => Response

const stubFetch = (handler: Handler) => {
  const requests: { url: string; init?: RequestInit }[] = []
  // Bun's `typeof fetch` also carries `preconnect`.
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        requests.push({ url, init })
        return handler(url, init)
      },
      { preconnect: fetch.preconnect },
    ),
  )
  return requests
}

const scheduled = <T>(module: Module<T>) => {
  if (!("fetch" in module)) throw new Error("usage must be scheduled")
  return module
}

const claude = () => scheduled(claudeUsage("personal", "sk-ant-oat01-token"))

// Gives the Module its own auth.json, as on the NAS.
const codex = async ({
  accessToken = "access",
  lastRefresh = new Date().toISOString(),
} = {}) => {
  const authPath = join(await mkdtemp(join(tmpdir(), "deskhud-")), "auth.json")
  await Bun.write(
    authPath,
    JSON.stringify({
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "id",
        access_token: accessToken,
        refresh_token: "refresh",
        account_id: "account",
      },
      last_refresh: lastRefresh,
    }),
  )
  return { authPath, usage: scheduled(codexUsage("work", authPath)) }
}

afterEach(() => {
  setSystemTime()
  mock.restore()
})

test("reads Claude 5-hour and weekly usage from the probe headers", async () => {
  setSystemTime(now)
  const requests = stubFetch(
    () => new Response("{}", { headers: claudeHeaders("0.42") }),
  )
  const usage = claude()

  const data = await usage.fetch()
  expect(data).toEqual({
    fiveHour: { used: 0.42, resetsAt: inHour * 1000 },
    weekly: { used: 0.3, resetsAt: inDays * 1000 },
  })
  expect(usage.id).toBe("claude-personal")
  const rendered = await usage.render(data)
  expect(rendered).toContain("personal")
  expect(rendered).toContain(">42%<")
  // 1h left of 5h, 3 days left of 7.
  expect(rendered).toContain("left: 80%")
  expect(rendered).toContain(`left: ${(4 / 7) * 100}%`)
  expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
    "Bearer sk-ant-oat01-token",
  )
})

test("reads Codex 5-hour and weekly usage", async () => {
  const requests = stubFetch(() => Response.json(wham))
  const { usage } = await codex()

  expect(await usage.fetch()).toEqual({
    fiveHour: { used: 0.25, resetsAt: inHour * 1000 },
    weekly: { used: 0.6, resetsAt: inDays * 1000 },
  })
  expect(usage.id).toBe("codex-work")
  expect(
    new Headers(requests[0]?.init?.headers).get("chatgpt-account-id"),
  ).toBe("account")
})

test("at the Claude limit, shows 100% and skips probes until the reset", async () => {
  setSystemTime(now)
  const requests = stubFetch(
    () => new Response("{}", { status: 429, headers: claudeHeaders("1") }),
  )
  const usage = claude()

  expect((await usage.fetch()).fiveHour?.used).toBe(1)
  setSystemTime(now + 30 * 60_000)
  expect((await usage.fetch()).fiveHour?.used).toBe(1)
  expect(requests).toHaveLength(1)

  setSystemTime((inHour + 1) * 1000)
  await usage.fetch()
  expect(requests).toHaveLength(2)
})

test("a rejected status holds probes until the reset", async () => {
  setSystemTime(now)
  const requests = stubFetch(
    () =>
      new Response("{}", {
        status: 429,
        headers: claudeHeaders("0.5", "rejected"),
      }),
  )
  const usage = claude()

  await usage.fetch()
  setSystemTime(now + 30 * 60_000)
  await usage.fetch()
  expect(requests).toHaveLength(1)
})

test("a probe without usage headers fails the Source", async () => {
  stubFetch(() => new Response("{}", { status: 401 }))

  await expect(claude().fetch()).rejects.toThrow("401")
})

test("an expired Codex token refreshes and persists to the Hub's own auth.json", async () => {
  const requests = stubFetch((url, init) => {
    if (url.includes("auth.openai.com"))
      return Response.json({
        id_token: "id2",
        access_token: "access2",
        refresh_token: "refresh2",
      })
    const token = new Headers(init?.headers).get("authorization")
    return token === "Bearer access2"
      ? Response.json(wham)
      : new Response("", { status: 401 })
  })
  const { usage, authPath } = await codex({ accessToken: "expired" })

  expect((await usage.fetch()).weekly?.used).toBe(0.6)
  const refresh = requests.find(({ url }) => url.includes("auth.openai.com"))
  expect(JSON.parse(String(refresh?.init?.body))).toMatchObject({
    grant_type: "refresh_token",
    refresh_token: "refresh",
  })
  const saved = await Bun.file(authPath).json()
  expect(saved.tokens).toEqual({
    id_token: "id2",
    access_token: "access2",
    refresh_token: "refresh2",
    account_id: "account",
  })
  expect(saved.OPENAI_API_KEY).toBeNull()
})

test("a Codex login older than 8 days refreshes before reading usage", async () => {
  const requests = stubFetch((url) =>
    url.includes("auth.openai.com")
      ? Response.json({ access_token: "access2" })
      : Response.json(wham),
  )
  const { usage } = await codex({
    lastRefresh: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  })

  await usage.fetch()
  expect(requests.map(({ url }) => new URL(url).host)).toEqual([
    "auth.openai.com",
    "chatgpt.com",
  ])
  expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe(
    "Bearer access2",
  )
})

test("Codex windows are matched by length, and either may be missing", async () => {
  stubFetch(() =>
    Response.json({
      rate_limit: {
        primary_window: wham.rate_limit.secondary_window,
        secondary_window: null,
      },
    }),
  )
  const { usage } = await codex()

  expect(await usage.fetch()).toEqual({
    fiveHour: undefined,
    weekly: { used: 0.6, resetsAt: inDays * 1000 },
  })
})
