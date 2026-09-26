import dayjs from "dayjs"
import { env } from "@/env"
import { connectHomeAssistant } from "@/ha"
import { createHub, tapTimeout } from "@/hub"
import type { Effects } from "@/module"
import { calendar } from "@/modules/calendar"
import { clock } from "@/modules/clock"
import { co2 } from "@/modules/co2"
import { light } from "@/modules/light"
import { sleep } from "@/modules/sleep"
import { tasks } from "@/modules/tasks"
import { threads } from "@/modules/threads"
import { trains } from "@/modules/trains"
import { claudeUsage, codexUsage } from "@/modules/usage"
import { weather } from "@/modules/weather"

const missingHa = new Error("HA_URL and HA_TOKEN must be set")
const ha: Effects["ha"] = env.ha
  ? connectHomeAssistant({
      url: env.ha.HA_URL,
      token: env.ha.HA_TOKEN,
      timeout: tapTimeout,
    })
  : {
      watch: (_entityId, source) => source.fail(missingHa),
      callService: async () => {
        throw missingHa
      },
    }

// The Workstation's forced command runs `open` on an https URL or a fixed app name (ADR 0002).
const runOnWorkstation = async (command: string) => {
  // Never fall back to the user's own keys: only the forced-command key may run.
  if (!env.ssh)
    throw new Error("WORKSTATION_SSH, SSH_KEY and SSH_KNOWN_HOSTS must be set")
  const { WORKSTATION_SSH, SSH_KEY, SSH_KNOWN_HOSTS } = env.ssh
  const ssh = Bun.spawn(
    [
      "ssh",
      "-T",
      // Ignores ~/.ssh/config, whose IdentityFile would still be offered.
      "-F",
      "/dev/null",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      "-o",
      "IdentitiesOnly=yes",
      "-i",
      SSH_KEY,
      "-o",
      `UserKnownHostsFile=${SSH_KNOWN_HOSTS}`,
      WORKSTATION_SSH,
      command,
    ],
    // Killed when the Hub gives up, so a late `open` can't follow the shown error.
    { stdout: "ignore", stderr: "pipe", timeout: tapTimeout },
  )
  if ((await ssh.exited) !== 0)
    throw new Error(
      `ssh exited ${ssh.exitCode}: ${await new Response(ssh.stderr).text()}`,
    )
}

const hub = createHub({
  modules: [
    clock,
    weather,
    trains,
    light,
    ...(env.co2 ? [co2(env.co2)] : []),
    ...(env.t3code.length > 0 ? [threads(env.t3code)] : []),
    ...(env.ticktick ? [tasks(env.ticktick)] : []),
    ...(env.googleCalendar
      ? [
          calendar(
            {
              clientId: env.googleCalendar.GOOGLE_CALENDAR_CLIENT_ID,
              clientSecret: env.googleCalendar.GOOGLE_CALENDAR_CLIENT_SECRET,
            },
            env.googleCalendar.GOOGLE_CALENDAR_TOKENS.map(
              ({ label, value }) => ({ label, refreshToken: value }),
            ),
          ),
        ]
      : []),
    ...(env.googleHealth
      ? [
          sleep({
            clientId: env.googleHealth.GOOGLE_HEALTH_CLIENT_ID,
            clientSecret: env.googleHealth.GOOGLE_HEALTH_CLIENT_SECRET,
            refreshToken: env.googleHealth.GOOGLE_HEALTH_REFRESH_TOKEN,
          }),
        ]
      : []),
    ...env.claude.map(({ label, value }) => claudeUsage(label, value)),
    ...env.codex.map(({ label, value }) => codexUsage(label, value)),
  ],
  effects: { ssh: { open: runOnWorkstation, activate: runOnWorkstation }, ha },
})

// Apache Common Log Format with numeric local time: 127.0.0.1 - - [2026-09-26 16:00:00] "GET / HTTP/1.1" 200 1234
const server = Bun.serve({
  port: env.port,
  // SSE clients (/events) stay open indefinitely.
  idleTimeout: 0,
  fetch: async (request, server) => {
    const response = await hub.handle(request)
    const ip = server.requestIP(request)?.address ?? "-"
    const { pathname, search } = new URL(request.url)
    const bytes = response.headers.get("content-length") ?? "-"
    console.log(
      `${ip} - - [${dayjs().format("YYYY-MM-DD HH:mm:ss")}] "${request.method} ${pathname}${search} HTTP/1.1" ${response.status} ${bytes}`,
    )
    return response
  },
})

console.log(`deskhud listening on ${server.url}`)
