import dayjs from "dayjs"
import { env } from "@/env"
import { connectHomeAssistant } from "@/ha"
import { createHub, tapTimeout } from "@/hub"
import type { Effects } from "@/module"
import { clock } from "@/modules/clock"
import { light } from "@/modules/light"
import { tasks } from "@/modules/tasks"
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

// The Workstation's forced command runs `open` on the URL (ADR 0002).
const openOnWorkstation = async (url: string) => {
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
      url,
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
    ...(env.ticktick ? [tasks(env.ticktick)] : []),
    ...env.claude.map(({ label, value }) => claudeUsage(label, value)),
    ...env.codex.map(({ label, value }) => codexUsage(label, value)),
  ],
  effects: { ssh: { open: openOnWorkstation }, ha },
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
