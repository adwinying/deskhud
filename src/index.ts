import dayjs from "dayjs"
import { createHub } from "@/hub"
import { clock } from "@/modules/clock"
import { weather } from "@/modules/weather"

const notImplemented = async () => {
  throw new Error("not implemented")
}

const hub = createHub({
  modules: [clock, weather],
  effects: {
    ssh: { open: notImplemented },
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
