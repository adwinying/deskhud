import { rename } from "node:fs/promises"
import { z } from "zod"
import { defineModule } from "@/module"
import { brands } from "@/modules/brands"

// A hung request would otherwise stall the schedule without ever going Stale.
const timeout = () => AbortSignal.timeout(30_000)

const numeric = z.string().min(1).transform(Number).pipe(z.number())

const ClaudeWindow = z
  .object({
    utilization: numeric,
    reset: numeric,
    status: z.string().nullish(),
  })
  .transform(({ utilization, reset, status }) => ({
    used: status === "rejected" ? 1 : utilization,
    resetsAt: reset * 1000,
  }))

// `heldUntil`: past a limit a probe only buys overage, so none is sent before the reset (ADR 0003).
const ClaudeProbe = z
  .object({
    status: z.string().nullish(),
    reset: numeric.nullish(),
    fiveHour: ClaudeWindow,
    weekly: ClaudeWindow,
  })
  .transform(({ status, reset, fiveHour, weekly }) => ({
    usage: { fiveHour, weekly },
    heldUntil: Math.max(
      status === "rejected" ? (reset ?? 0) * 1000 : 0,
      ...[fiveHour, weekly]
        .filter(({ used }) => used >= 1)
        .map(({ resetsAt }) => resetsAt),
    ),
  }))

// Probes with a 1-token Haiku request and reads the rate-limit headers (ADR 0003).
const probeClaude = async (token: string) => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "." }],
    }),
    signal: timeout(),
  })
  const header = (name: string) =>
    response.headers.get(`anthropic-ratelimit-unified-${name}`)
  const claim = (name: string) => ({
    utilization: header(`${name}-utilization`),
    reset: header(`${name}-reset`),
    status: header(`${name}-status`),
  })
  // Assumes the 429 at a limit still carries the headers; unverified (#8).
  const probe = ClaudeProbe.safeParse({
    status: header("status"),
    reset: header("reset"),
    fiveHour: claim("5h"),
    weekly: claim("7d"),
  })
  if (!probe.success)
    throw new Error(`Claude probe responded ${response.status}`, {
      cause: probe.error,
    })
  return probe.data
}

const AuthFile = z.looseObject({
  tokens: z.looseObject({
    access_token: z.string(),
    refresh_token: z.string(),
    account_id: z.string(),
  }),
  last_refresh: z.string().optional(),
})

const Refreshed = z.object({
  id_token: z.string().optional(),
  access_token: z.string(),
  refresh_token: z.string().optional(),
})

const CodexWindow = z
  .object({
    used_percent: z.number(),
    limit_window_seconds: z.number(),
    reset_at: z.number(),
  })
  .nullish()

// Either window may be missing depending on the plan, so each is matched by its length.
const CodexUsage = z
  .object({
    rate_limit: z.object({
      primary_window: CodexWindow,
      secondary_window: CodexWindow,
    }),
  })
  .transform(({ rate_limit: { primary_window, secondary_window } }) => {
    const lasting = (seconds: number) => {
      const window = [primary_window, secondary_window].find(
        (window) => window?.limit_window_seconds === seconds,
      )
      return window
        ? { used: window.used_percent / 100, resetsAt: window.reset_at * 1000 }
        : undefined
    }
    return { fiveHour: lasting(5 * 3600), weekly: lasting(7 * 86_400) }
  })
  .refine(({ fiveHour, weekly }) => fiveHour || weekly, "no known window")

type Window = z.output<typeof ClaudeWindow>
type Auth = z.output<typeof AuthFile>

// The Codex CLI refreshes on the same schedule, before the refresh token can lapse.
const refreshAge = 8 * 86_400_000

// Refresh tokens are single-use, so the Hub keeps its own login rather than sharing the Workstation's (ADR 0003).
const refreshCodex = async (path: string, auth: Auth) => {
  const response = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      // Codex CLI's public OAuth client.
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      grant_type: "refresh_token",
      refresh_token: auth.tokens.refresh_token,
      scope: "openid profile email",
    }),
    signal: timeout(),
  })
  if (!response.ok)
    throw new Error(`Codex token refresh responded ${response.status}`)
  const tokens = { ...auth.tokens, ...Refreshed.parse(await response.json()) }
  // The old refresh token is already spent, so a torn write would lose the login.
  const temp = `${path}.tmp`
  await Bun.write(
    temp,
    JSON.stringify(
      { ...auth, tokens, last_refresh: new Date().toISOString() },
      null,
      2,
    ),
  )
  await rename(temp, path)
  return tokens
}

const readCodex = async (path: string) => {
  const auth = AuthFile.parse(await Bun.file(path).json())
  const requestUsage = (tokens: Auth["tokens"]) =>
    fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "chatgpt-account-id": tokens.account_id,
        accept: "application/json",
        "user-agent": "deskhud",
      },
      signal: timeout(),
    })
  const due =
    !auth.last_refresh ||
    Date.now() - Date.parse(auth.last_refresh) > refreshAge
  const tokens = due ? await refreshCodex(path, auth) : auth.tokens
  let response = await requestUsage(tokens)
  // A just-refreshed token is never refreshed again: its refresh token is already spent.
  if (response.status === 401 && !due)
    response = await requestUsage(await refreshCodex(path, auth))
  if (!response.ok) throw new Error(`Codex usage responded ${response.status}`)
  return CodexUsage.parse(await response.json())
}

const hour = 3_600_000

// The marker shows how far through its window the reset is, so usage reads against time.
const Bar = ({
  label,
  window: { used, resetsAt },
  length,
}: {
  label: string
  window: Window
  length: number
}) => {
  const remaining = resetsAt - Date.now()
  return (
    <>
      <dt class="text-neutral-400">{label}</dt>
      <dd class="relative h-2 self-center rounded-full bg-neutral-800">
        <div
          class={`h-full rounded-full ${used >= 1 ? "bg-red-500" : "bg-green-500"}`}
          style={`width: ${Math.min(used, 1) * 100}%`}
        />
        {remaining > 0 && remaining <= length && (
          <div
            class="absolute top-1/2 h-3.5 w-0.75 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
            style={`left: ${(1 - remaining / length) * 100}%`}
          />
        )}
      </dd>
      <dd class="text-right">{Math.round(used * 100)}%</dd>
    </>
  )
}

type Usage = { fiveHour?: Window; weekly?: Window }

// One Module per account, so a failing login only marks its own Module Stale.
const account = (
  name: "Claude" | "Codex",
  label: string,
  fetch: () => Promise<Usage>,
) =>
  defineModule({
    id: `${name.toLowerCase()}-${label}`,
    span: 2,
    priority: 35,
    schedule: { every: 5 * 60_000 },
    fetch,
    render: ({ fiveHour, weekly }) => (
      <div class="flex h-full flex-col justify-center gap-1 rounded-xl bg-neutral-900 p-4">
        <p class="flex items-center gap-1.5 text-sm font-semibold text-neutral-400">
          <span class="text-base">{brands[name]}</span>
          {label}
        </p>
        <dl class="grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-1 text-xs tabular-nums">
          {fiveHour && <Bar label="5h" window={fiveHour} length={5 * hour} />}
          {weekly && <Bar label="週" window={weekly} length={7 * 24 * hour} />}
        </dl>
      </div>
    ),
  })

export const claudeUsage = (label: string, token: string) => {
  let lastProbe: z.output<typeof ClaudeProbe> | undefined
  return account("Claude", label, async () => {
    if (!lastProbe || Date.now() >= lastProbe.heldUntil)
      lastProbe = await probeClaude(token)
    return lastProbe.usage
  })
}

export const codexUsage = (label: string, authPath: string) =>
  account("Codex", label, () => readCodex(authPath))
