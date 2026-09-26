import { html } from "@elysiajs/html"
import { Elysia } from "elysia"
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

export const createHub = ({ modules, effects }: HubOptions) => {
  const store = new Map<string, Entry>()
  const sentModules = new Map<string, string>()
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
  let sentLayout = ""

  const priorityOf = (module: Module<unknown>) =>
    module.effectivePriority?.(store.get(module.id)?.data) ?? module.priority

  const shownModules = (now = new Date()) =>
    modules
      .filter(
        (module) =>
          store.has(module.id) &&
          (module.visible?.(store.get(module.id)?.data, now) ?? true),
      )
      .toSorted((a, b) => priorityOf(b) - priorityOf(a))

  const renderModule = async (module: Module<unknown>) => {
    const entry = store.get(module.id)
    return (
      <section
        id={`module-${module.id}`}
        class={`relative col-span-${module.span}`}
      >
        {await module.render(entry?.data)}
        {entry?.stale && (
          <p class="absolute -top-2 right-2 rounded bg-amber-400 px-1 text-xs text-black">
            ⚠ {formatAge(Date.now() - entry.fetchedAt)} ago
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

  for (const module of modules) {
    const refresh = async () => {
      try {
        store.set(module.id, {
          data: await module.fetch(),
          fetchedAt: Date.now(),
          stale: false,
        })
      } catch (error) {
        console.error(`module ${module.id} fetch failed`, error)
        const entry = store.get(module.id)
        if (entry) entry.stale = true
      }
      await publish(module)
      // Chained rather than setInterval so a slow fetch never overlaps the next one.
      setTimeout(refresh, module.schedule.every).unref()
    }
    refresh()
  }

  // Keeps Stale ages current between fetches.
  setInterval(() => {
    for (const module of modules)
      if (store.get(module.id)?.stale) publish(module)
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
    .post("/tap/:id", async ({ params, status }) => {
      const tap = modules.find(({ id }) => id === params.id)?.tap
      if (!tap) return status(404)
      await tap(effects)
      return status(204)
    })
}
