import { html } from "@elysiajs/html"
import { Elysia } from "elysia"
import { TriangleAlert, X } from "lucide-static"
import { icon } from "@/icon"
import type { Effects, Module } from "@/module"
import { Page } from "@/page"

type HubOptions = {
  modules: Module<unknown>[]
  effects: Effects
}

const encoder = new TextEncoder()

const patchElements = (elements: string) =>
  encoder.encode(
    `event: datastar-patch-elements\n${elements
      .split("\n")
      .map((line) => `data: elements ${line}`)
      .join("\n")}\n\n`,
  )

/** Stale if the latest fetch failed; `data` is then the Last known good. */
type Entry = { data: unknown; fetchedAt: number; stale: boolean }

const formatAge = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`
}

export const tapTimeout = 5000
const tapErrorDuration = 3000

// Compared by identity, so a stale timer never clears a newer tap's state.
type TapState = { status: "pending" | "failed" }

export const createHub = ({ modules, effects }: HubOptions) => {
  const store = new Map<string, Entry>()
  const sentModules = new Map<string, string>()
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const taps = new Map<string, TapState>()
  let sentLayout = ""

  const priorityOf = (module: Module<unknown>, now: Date) =>
    module.effectivePriority?.(store.get(module.id)?.data, now) ??
    module.priority

  const shownModules = (now = new Date()) =>
    modules
      .filter(
        (module) =>
          store.has(module.id) &&
          (module.visible?.(store.get(module.id)?.data, now) ?? true),
      )
      .toSorted((a, b) => priorityOf(b, now) - priorityOf(a, now))

  const renderModule = async (module: Module<unknown>) => {
    const entry = store.get(module.id)
    const tap = taps.get(module.id)?.status
    return (
      <section
        id={`module-${module.id}`}
        class={`relative col-span-${module.span} ${module.tap ? "cursor-pointer" : ""} ${tap === "pending" ? "animate-pulse" : ""}`}
        aria-busy={tap === "pending" ? "true" : undefined}
        data-on:click={module.tap && `@post('/tap/${module.id}')`}
      >
        {await module.render(entry?.data)}
        {tap === "failed" && (
          <p class="absolute -top-2 left-2 flex items-center gap-1 rounded bg-red-500 px-1 text-xs text-white">
            {icon(X)} tap failed
          </p>
        )}
        {entry?.stale && (
          <p class="absolute -top-2 right-2 flex items-center gap-1 rounded bg-amber-400 px-1 text-xs text-black">
            {icon(TriangleAlert)} {formatAge(Date.now() - entry.fetchedAt)} ago
          </p>
        )}
      </section>
    )
  }

  const renderGrid = async () => (
    <main id="grid" class="grid grid-flow-dense grid-cols-4 gap-3">
      {await Promise.all(shownModules().map(renderModule))}
    </main>
  )

  const broadcast = (elements: string) => {
    const event = patchElements(elements)
    for (const client of clients) {
      try {
        client.enqueue(event)
      } catch {
        clients.delete(client)
      }
    }
  }

  // Order or visibility changes re-send the whole grid; otherwise only the changed Module.
  const publish = async (module: Module<unknown>) => {
    try {
      const shown = shownModules()
      const layout = shown.map(({ id }) => id).join()
      const rendered = shown.includes(module) ? await renderModule(module) : ""

      if (layout !== sentLayout) broadcast(await renderGrid())
      else if (rendered !== sentModules.get(module.id)) broadcast(rendered)

      sentLayout = layout
      sentModules.set(module.id, rendered)
    } catch (error) {
      console.error(`module ${module.id} publish failed`, error)
    }
  }

  const setTap = (module: Module<unknown>, state?: TapState) => {
    if (state) taps.set(module.id, state)
    else taps.delete(module.id)
    publish(module)
  }

  // The Module ID doubles as the Tap action ID, so the Kiosk never sends what the tap does.
  const runTap = async (module: Module<unknown>, action?: string) => {
    setTap(module, { status: "pending" })
    try {
      await Promise.race([
        module.tap?.(effects, store.get(module.id)?.data, action),
        Bun.sleep(tapTimeout).then(() => {
          throw new Error(`timed out after ${tapTimeout}ms`)
        }),
      ])
      setTap(module)
    } catch (error) {
      console.error(`module ${module.id} tap failed`, error)
      const failed: TapState = { status: "failed" }
      setTap(module, failed)
      await Bun.sleep(tapErrorDuration)
      if (taps.get(module.id) === failed) setTap(module)
    }
  }

  const record = (module: Module<unknown>, data: unknown) => {
    store.set(module.id, { data, fetchedAt: Date.now(), stale: false })
    return publish(module)
  }

  const markStale = (module: Module<unknown>, error: unknown) => {
    console.error(`module ${module.id} Source failed`, error)
    const entry = store.get(module.id)
    if (entry) entry.stale = true
    return publish(module)
  }

  for (const module of modules) {
    if ("subscribe" in module) {
      module.subscribe(effects, {
        next: (data) => record(module, data),
        fail: (error) => {
          // A push Source was confirmed good up to the moment it dropped.
          const entry = store.get(module.id)
          if (entry && !entry.stale) entry.fetchedAt = Date.now()
          markStale(module, error)
        },
      })
      continue
    }
    const refresh = async () => {
      try {
        await record(module, await module.fetch())
      } catch (error) {
        await markStale(module, error)
      }
      // Chained rather than setInterval so a slow fetch never overlaps the next one.
      setTimeout(refresh, module.schedule.every).unref()
    }
    refresh()
  }

  // Keeps Stale ages and time-based visibility current between readings.
  setInterval(() => {
    for (const module of modules) publish(module)
  }, 60_000).unref()

  return new Elysia()
    .use(html())
    .get("/", async () => <Page>{await renderGrid()}</Page>)
    .get("/events", () => {
      let client: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const snapshot = patchElements(await renderGrid())
          client = controller
          client.enqueue(snapshot)
          clients.add(client)
        },
        cancel() {
          clients.delete(client)
        },
      })
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      })
    })
    .post("/tap/:id/:action?", ({ params, status }) => {
      const module = modules.find(({ id }) => id === params.id)
      if (!module?.tap) return status(404)
      if (taps.get(module.id)?.status === "pending") return status(409)
      runTap(module, params.action)
      return status(202)
    })
}
