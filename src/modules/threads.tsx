import { SquareTerminal } from "lucide-static"
import { z } from "zod"
import { icon } from "@/icon"
import { defineModule, type PushSource } from "@/module"

// The fields of T3 Code's OrchestrationThreadShell that decide attention.
const Thread = z.object({
  id: z.string(),
  title: z.string(),
  archivedAt: z.string().nullable(),
  settledAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  pinnedAt: z.string().nullable(),
  hasPendingApprovals: z.boolean(),
  hasPendingUserInput: z.boolean(),
  hasActionableProposedPlan: z.boolean(),
  latestTurn: z.object({ state: z.string() }).nullable(),
  session: z.object({ status: z.string() }).nullable(),
})
type Thread = z.infer<typeof Thread>

const Snapshot = z.object({ snapshot: z.object({ threads: z.array(Thread) }) })
const Upserted = z.object({ thread: Thread })
const Removed = z.object({ threadId: z.string() })

// Effect RPC's JSON protocol, server → client.
const Message = z.discriminatedUnion("_tag", [
  z.object({
    _tag: z.literal("Chunk"),
    requestId: z.string(),
    values: z.array(z.object({ kind: z.string() }).loose()),
  }),
  z.object({ _tag: z.literal("Pong") }),
  z.object({ _tag: z.literal("Exit"), exit: z.unknown() }),
  z.object({ _tag: z.literal("Defect"), defect: z.unknown() }),
])

const reasons = {
  approval: "承認待",
  question: "回答待",
  plan: "プラン確認",
  error: "エラー",
  done: "完了",
}
type Reason = keyof typeof reasons
const urgency = Object.keys(reasons)

export type Attention = { title: string; reason: Reason }

const byUrgency = (a: Attention, b: Attention) =>
  urgency.indexOf(a.reason) - urgency.indexOf(b.reason)

// Mirrors T3 Code's agentAwareness phases, limited to threads still in the sidebar's active list.
const reasonOf = (thread: Thread, now: number): Reason | undefined => {
  if (thread.archivedAt || thread.settledAt) return
  if (thread.snoozedUntil && Date.parse(thread.snoozedUntil) > now) return
  if (thread.hasPendingApprovals) return "approval"
  if (thread.hasPendingUserInput) return "question"
  if (thread.hasActionableProposedPlan) return "plan"
  if (
    thread.session?.status === "error" ||
    thread.latestTurn?.state === "error"
  )
    return "error"
  if (
    thread.session?.status === "running" ||
    thread.session?.status === "starting" ||
    thread.latestTurn?.state === "running"
  )
    return
  // Pinned threads are long-lived; finishing a turn there isn't a call to act.
  if (thread.pinnedAt) return
  return "done"
}

/** Most urgent first. */
export const attention = (threads: Iterable<Thread>, now: number) =>
  [...threads]
    .flatMap((thread) => {
      const reason = reasonOf(thread, now)
      return reason ? [{ title: thread.title, reason }] : []
    })
    .toSorted(byUrgency)

const reconnectDelay = 5_000
// lib.dom's WebSocket type shadows Bun's, whose constructor also takes headers.
const BunWebSocket = WebSocket as unknown as new (
  url: string,
  options: Bun.WebSocketOptions,
) => WebSocket
// Detects a silently dead connection, which would never fire `close`.
const pingInterval = 30_000

type Environment = { label: string; url: string; token: string }

const watchThreads = (
  { url, token }: Environment,
  source: PushSource<Attention[]>,
) => {
  const connect = () => {
    const socket = new BunWebSocket(`${url.replace(/^http/, "ws")}/ws`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const threads = new Map<string, Thread>()
    let alive = true
    let dropped = false

    const drop = (error: Error) => {
      if (dropped) return
      dropped = true
      clearInterval(ping)
      socket.close()
      source.fail(error)
      setTimeout(connect, reconnectDelay)
    }

    const ping = setInterval(() => {
      if (!alive) return drop(new Error("T3 Code stopped responding"))
      alive = false
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ _tag: "Ping" }))
    }, pingInterval)

    const apply = (event: { kind: string }) => {
      switch (event.kind) {
        case "snapshot":
          threads.clear()
          for (const thread of Snapshot.parse(event).snapshot.threads)
            threads.set(thread.id, thread)
          break
        case "thread-upserted": {
          const { thread } = Upserted.parse(event)
          threads.set(thread.id, thread)
          break
        }
        case "thread-removed":
          threads.delete(Removed.parse(event).threadId)
      }
    }

    socket.addEventListener("open", () =>
      socket.send(
        JSON.stringify({
          _tag: "Request",
          id: "1",
          tag: "orchestration.subscribeShell",
          payload: {},
          headers: [],
        }),
      ),
    )
    // A rejected token fails the upgrade and lands here too.
    socket.addEventListener("close", ({ code }) =>
      drop(new Error(`T3 Code websocket closed (${code})`)),
    )
    socket.addEventListener("message", ({ data }) => {
      alive = true
      try {
        const message = Message.parse(JSON.parse(String(data)))
        switch (message._tag) {
          case "Chunk":
            message.values.forEach(apply)
            // The server holds further chunks until acked.
            socket.send(
              JSON.stringify({ _tag: "Ack", requestId: message.requestId }),
            )
            source.next(attention(threads.values(), Date.now()))
            break
          case "Exit":
          case "Defect":
            drop(new Error("T3 Code ended the thread stream"))
        }
      } catch (error) {
        drop(new Error("unexpected T3 Code message", { cause: error }))
      }
    })
  }
  connect()
}

type Labeled = Attention & { machine: string }

// Across all environments, so one sleeping machine neither hides the others nor flaps the Stale badge.
const watchEnvironments = (
  environments: Environment[],
  source: PushSource<Labeled[]>,
) => {
  // A dropped environment keeps its Last known good until it reconnects.
  const lists = new Map<string, Labeled[]>()
  const down = new Set<string>()
  for (const environment of environments)
    watchThreads(environment, {
      next: (list) => {
        down.delete(environment.label)
        lists.set(
          environment.label,
          list.map((item) => ({ ...item, machine: environment.label })),
        )
        source.next([...lists.values()].flat().toSorted(byUrgency))
      },
      fail: (error) => {
        down.add(environment.label)
        if (down.size === environments.length) source.fail(error)
        else console.error(`T3 Code ${environment.label} failed`, error)
      },
    })
}

export const threads = (environments: Environment[]) =>
  defineModule<Labeled[]>({
    id: "threads",
    span: 4,
    // Just under the CO2 warning.
    priority: 190,
    subscribe: (_, source) => watchEnvironments(environments, source),
    tap: ({ ssh }) => ssh.activate("t3code"),
    visible: (list) => list.length > 0,
    render: ([first, ...rest]) => (
      <p class="flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2 font-semibold text-black">
        <span class="shrink-0">{icon(SquareTerminal)}</span>
        <span class="truncate" safe>
          {first?.title}
        </span>
        <span class="shrink-0">
          {first && reasons[first.reason]}
          {rest.length > 0 && ` 他${rest.length}件`}
        </span>
      </p>
    ),
  })
