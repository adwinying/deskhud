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

export const createHub = ({ modules, effects }: HubOptions) => {
  const store = new Map<string, unknown>()
  const sentModules = new Map<string, string>()
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
  let sentLayout = ""

  const priorityOf = (module: Module<unknown>) =>
    module.effectivePriority?.(store.get(module.id)) ?? module.priority

  const shownModules = (now = new Date()) =>
    modules
      .filter(
        (module) =>
          store.has(module.id) &&
          (module.visible?.(store.get(module.id), now) ?? true),
      )
      .toSorted((a, b) => priorityOf(b) - priorityOf(a))

  const renderModule = async (module: Module<unknown>) => (
    <section id={`module-${module.id}`} class={`col-span-${module.span}`}>
      {await module.render(store.get(module.id))}
    </section>
  )

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
    const shown = shownModules()
    const layout = shown.map(({ id }) => id).join()
    const rendered = shown.includes(module) ? await renderModule(module) : ""

    if (layout !== sentLayout) broadcast(await renderGrid())
    else if (rendered !== sentModules.get(module.id)) broadcast(rendered)

    sentLayout = layout
    sentModules.set(module.id, rendered)
  }

  for (const module of modules) {
    const refresh = async () => {
      try {
        store.set(module.id, await module.fetch())
        await publish(module)
      } catch (error) {
        console.error(`module ${module.id} refresh failed`, error)
      }
      // Chained rather than setInterval so a slow fetch never overlaps the next one.
      setTimeout(refresh, module.schedule.every).unref()
    }
    refresh()
  }

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
