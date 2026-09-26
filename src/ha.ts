import { z } from "zod"
import type { Effects, PushSource } from "@/module"

// subscribe_entities' compressed format: `a` adds entities (sent on subscribe), `c` diffs them.
const EntitiesEvent = z.object({
  a: z.record(z.string(), z.object({ s: z.string() })).default({}),
  c: z
    .record(
      z.string(),
      z.object({ "+": z.object({ s: z.string().optional() }).optional() }),
    )
    .default({}),
})

// https://developers.home-assistant.io/docs/api/websocket
const Message = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["auth_required", "auth_ok", "pong"]) }),
  z.object({ type: z.literal("auth_invalid"), message: z.string() }),
  z.object({
    type: z.literal("result"),
    id: z.number(),
    success: z.boolean(),
    error: z.object({ message: z.string() }).optional(),
  }),
  z.object({ type: z.literal("event"), event: EntitiesEvent }),
])

const reconnectDelay = 5_000
// Detects a silently dead connection, which would never fire `close`.
const pingInterval = 30_000

export const connectHomeAssistant = ({
  url,
  token,
  timeout,
}: {
  url: string
  token: string
  /** How long `callService` waits for the state change. */
  timeout: number
}): Effects["ha"] => {
  const sources = new Map<string, PushSource<string>>()
  const changeWaiters = new Map<string, Set<() => void>>()
  const requests = new Map<
    number,
    { resolve(): void; reject(error: Error): void }
  >()
  let nextId = 1
  let authed: WebSocket | undefined

  const request = (message: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => {
      if (!authed) return reject(new Error("Home Assistant is not connected"))
      const id = nextId++
      requests.set(id, { resolve, reject })
      authed.send(JSON.stringify({ ...message, id }))
    })

  const subscribe = (entityId: string) =>
    request({ type: "subscribe_entities", entity_ids: [entityId] }).catch(
      (error) => sources.get(entityId)?.fail(error),
    )

  const waitForChange = (entityId: string) =>
    new Promise<void>((resolve, reject) => {
      const waiters = changeWaiters.get(entityId) ?? new Set()
      changeWaiters.set(entityId, waiters)
      const changed = () => {
        clearTimeout(timer)
        waiters.delete(changed)
        resolve()
      }
      const timer = setTimeout(() => {
        waiters.delete(changed)
        reject(new Error(`${entityId} did not change within ${timeout}ms`))
      }, timeout)
      waiters.add(changed)
    })

  const receive = ({ a, c }: z.infer<typeof EntitiesEvent>) => {
    for (const [entityId, { s }] of Object.entries(a))
      sources.get(entityId)?.next(s)
    for (const [entityId, diff] of Object.entries(c)) {
      const state = diff["+"]?.s
      if (state === undefined) continue
      sources.get(entityId)?.next(state)
      for (const changed of changeWaiters.get(entityId) ?? []) changed()
    }
  }

  const connect = () => {
    const socket = new WebSocket(`${url.replace(/^http/, "ws")}/api/websocket`)
    let alive = true
    let dropped = false

    const drop = (error: Error, retry = true) => {
      if (dropped) return
      dropped = true
      clearInterval(ping)
      authed = undefined
      socket.close()
      for (const { reject } of requests.values()) reject(error)
      requests.clear()
      for (const source of sources.values()) source.fail(error)
      if (retry) setTimeout(connect, reconnectDelay)
    }

    const ping = setInterval(() => {
      if (!alive) return drop(new Error("Home Assistant stopped responding"))
      alive = false
      // A connect that hangs past two ticks drops too.
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ id: nextId++, type: "ping" }))
    }, pingInterval)

    socket.addEventListener("close", ({ code }) =>
      drop(new Error(`Home Assistant websocket closed (${code})`)),
    )
    socket.addEventListener("message", ({ data }) => {
      alive = true
      const parsed = Message.safeParse(JSON.parse(String(data)))
      if (!parsed.success)
        return drop(
          new Error("unexpected Home Assistant message", {
            cause: parsed.error,
          }),
        )
      const message = parsed.data
      switch (message.type) {
        case "auth_required":
          socket.send(JSON.stringify({ type: "auth", access_token: token }))
          break
        case "auth_ok":
          authed = socket
          for (const entityId of sources.keys()) subscribe(entityId)
          break
        case "auth_invalid":
          // Retrying a bad token would count toward HA's IP ban.
          drop(
            new Error(`Home Assistant auth failed: ${message.message}`),
            false,
          )
          break
        case "result": {
          const pending = requests.get(message.id)
          requests.delete(message.id)
          if (message.success) pending?.resolve()
          else pending?.reject(new Error(message.error?.message))
          break
        }
        case "event":
          receive(message.event)
      }
    })
  }
  connect()

  return {
    watch: (entityId, source) => {
      sources.set(entityId, source)
      if (authed) subscribe(entityId)
    },
    callService: async (domain, service, data) => {
      // Registered first: HA may report the change before the call's result.
      const changed = waitForChange(data.entity_id)
      await Promise.all([
        request({ type: "call_service", domain, service, service_data: data }),
        changed,
      ])
    },
  }
}
