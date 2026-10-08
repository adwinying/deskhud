import dayjs from "dayjs"
import { env } from "@/env"
import { connectHomeAssistant } from "@/ha"
import { createHub, tapTimeout } from "@/hub"
import type { Effects, PushSource } from "@/module"
import { calendar } from "@/modules/calendar"
import { clock } from "@/modules/clock"
import { co2 } from "@/modules/co2"
import { humidity } from "@/modules/humidity"
import { light } from "@/modules/light"
import { media } from "@/modules/media"
import { sleep } from "@/modules/sleep"
import { tasks } from "@/modules/tasks"
import { threads } from "@/modules/threads"
import { trains } from "@/modules/trains"
import { claudeUsage, codexUsage } from "@/modules/usage"
import { weather } from "@/modules/weather"
import { syncPresence } from "@/presence"

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

// The Workstation's forced command maps each command to `open` or `media-control` (ADR 0002).
const sshCommand = (command: string) => {
  // Never fall back to the user's own keys: only the forced-command key may run.
  if (!env.ssh)
    throw new Error("WORKSTATION_SSH, SSH_KEY and SSH_KNOWN_HOSTS must be set")
  const { WORKSTATION_SSH, SSH_KEY, SSH_KNOWN_HOSTS } = env.ssh
  return [
    "ssh",
    "-T",
    // Ignores ~/.ssh/config, whose IdentityFile would still be offered.
    "-F",
    "/dev/null",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    // Ends a silently dead stream, which would otherwise never exit.
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "IdentitiesOnly=yes",
    "-i",
    SSH_KEY,
    "-o",
    `UserKnownHostsFile=${SSH_KNOWN_HOSTS}`,
    WORKSTATION_SSH,
    command,
  ]
}

const runOnWorkstation = async (command: string) => {
  const ssh = Bun.spawn(
    sshCommand(command),
    // Killed when the Hub gives up, so a late `open` can't follow the shown error.
    { stdout: "ignore", stderr: "pipe", timeout: tapTimeout },
  )
  if ((await ssh.exited) !== 0)
    throw new Error(
      `ssh exited ${ssh.exitCode}: ${await new Response(ssh.stderr).text()}`,
    )
}

const reconnectDelay = 5_000

const watchOnWorkstation = (command: string, source: PushSource<string>) => {
  const connect = async () => {
    const ssh = Bun.spawn(sshCommand(command), {
      stdout: "pipe",
      stderr: "inherit",
    })
    try {
      let partial = ""
      for await (const chunk of ssh.stdout.pipeThrough(
        new TextDecoderStream(),
      )) {
        const lines = (partial + chunk).split("\n")
        partial = lines.pop() ?? ""
        for (const line of lines) if (line) source.next(line)
      }
      throw new Error(`ssh exited ${await ssh.exited}`)
    } catch (error) {
      ssh.kill()
      source.fail(error)
      setTimeout(connect, reconnectDelay)
    }
  }
  connect()
}

const hub = createHub({
  modules: [
    clock,
    weather,
    trains,
    light,
    ...(env.co2 ? [co2(env.co2), humidity(env.co2)] : []),
    ...(env.t3code.length > 0 ? [threads(env.t3code)] : []),
    ...(env.ticktick ? [tasks(env.ticktick)] : []),
    ...(env.googleCalendar
      ? [
          calendar(
            {
              clientId: env.googleCalendar.GOOGLE_CALENDAR_CLIENT_ID,
              clientSecret: env.googleCalendar.GOOGLE_CALENDAR_CLIENT_SECRET,
            },
            env.googleCalendar.GOOGLE_CALENDAR_TOKENS,
          ),
        ]
      : []),
    ...(env.ssh ? [media] : []),
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
  effects: {
    ssh: {
      open: runOnWorkstation,
      activate: runOnWorkstation,
      media: (command) => runOnWorkstation(`media-${command}`),
      watchMedia: (source) => watchOnWorkstation("media-stream", source),
    },
    ha,
  },
})

if (env.kioskAdmin) syncPresence(ha, env.kioskAdmin)

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
