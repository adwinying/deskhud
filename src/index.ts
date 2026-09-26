import dayjs from "dayjs"
import { createHub, tapTimeout } from "@/hub"
import { clock } from "@/modules/clock"
import { trains } from "@/modules/trains"
import { weather } from "@/modules/weather"

const notImplemented = async () => {
  throw new Error("not implemented")
}

// The Workstation's forced command runs `open` on the URL (ADR 0002).
const openOnWorkstation = async (url: string) => {
  const { WORKSTATION_SSH, SSH_KEY, SSH_KNOWN_HOSTS } = process.env
  // Never fall back to the user's own keys: only the forced-command key may run.
  if (!WORKSTATION_SSH || !SSH_KEY || !SSH_KNOWN_HOSTS)
    throw new Error("WORKSTATION_SSH, SSH_KEY and SSH_KNOWN_HOSTS must be set")
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
  modules: [clock, weather, trains],
  effects: {
    ssh: { open: openOnWorkstation },
    ha: { callService: notImplemented },
  },
})

// Apache Common Log Format with numeric local time: 127.0.0.1 - - [2026-09-26 16:00:00] "GET / HTTP/1.1" 200 1234
const server = Bun.serve({
  port: process.env.PORT ?? 3000,
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
