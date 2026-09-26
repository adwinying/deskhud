import { expect, setSystemTime, spyOn, test } from "bun:test"
import { createHub } from "@/hub"
import { defineModule, type PushSource } from "@/module"
import { light, lightEntity } from "@/modules/light"

const effects = {
  ssh: { open: async () => {}, activate: async () => {} },
  ha: { callService: async () => {}, watch: () => {} },
}

const readUntil = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
) => {
  const decoder = new TextDecoder()
  let text = ""
  while (!text.includes(needle)) {
    const { value, done } = await reader.read()
    if (done) throw new Error(`stream ended before "${needle}":\n${text}`)
    text += decoder.decode(value)
  }
  return text
}

test("Hub serves visible Modules and streams patches", async () => {
  let reading = "first"
  const every = 5
  const hub = createHub({
    modules: [
      defineModule({
        id: "low",
        span: 4,
        priority: 1,
        schedule: { every },
        fetch: () => reading,
        render: (value) => <p>reading {value}</p>,
      }),
      defineModule({
        id: "high",
        span: 2,
        priority: 5,
        schedule: { every },
        fetch: () => "high",
        render: () => <p>high module</p>,
      }),
      defineModule({
        id: "hidden",
        span: 1,
        priority: 9,
        schedule: { every },
        fetch: () => "hidden",
        visible: () => false,
        render: () => <p>hidden module</p>,
      }),
    ],
    effects,
  })
  await Bun.sleep(50)

  const page = await hub
    .handle(new Request("http://localhost/"))
    .then((r) => r.text())
  expect(page).toContain("reading first")
  expect(page).toContain("high module")
  expect(page).not.toContain("hidden module")
  expect(page.indexOf("high module")).toBeLessThan(
    page.indexOf("reading first"),
  )
  expect(page).toMatch(/id="module-high"[^>]*col-span-2/)

  const events = await hub.handle(new Request("http://localhost/events"))
  expect(events.headers.get("content-type")).toContain("text/event-stream")
  const reader = events.body?.getReader()
  if (!reader) throw new Error("SSE response has no body")

  const snapshot = await readUntil(reader, "\n\n")
  expect(snapshot).toStartWith("event: datastar-patch-elements\n")
  expect(snapshot).toContain("reading first")
  expect(snapshot).toContain("high module")

  reading = "second"
  const patch = await readUntil(reader, "reading second")
  expect(patch).toContain('id="module-low"')
  expect(patch).not.toContain("high module")

  await reader.cancel()
})

test("visibility and effective Priority changes re-order the grid live", async () => {
  let alert = false
  const hub = createHub({
    modules: [
      defineModule({
        id: "base",
        span: 4,
        priority: 5,
        schedule: { every: 5 },
        fetch: () => "base",
        render: () => <p>base module</p>,
      }),
      defineModule({
        id: "alert",
        span: 4,
        priority: 1,
        schedule: { every: 5 },
        fetch: () => alert,
        visible: (active) => active,
        effectivePriority: (active) => (active ? 10 : 1),
        render: () => <p>alert module</p>,
      }),
    ],
    effects,
  })
  await Bun.sleep(50)

  const events = await hub.handle(new Request("http://localhost/events"))
  const reader = events.body?.getReader()
  if (!reader) throw new Error("SSE response has no body")
  expect(await readUntil(reader, "\n\n")).not.toContain("alert module")

  alert = true
  const shown = await readUntil(reader, "alert module")
  expect(shown).toContain('id="grid"')
  expect(shown.indexOf("alert module")).toBeLessThan(
    shown.indexOf("base module"),
  )

  alert = false
  const hidden = await readUntil(reader, 'id="grid"')
  expect(hidden).toContain("base module")
  expect(hidden).not.toContain("alert module")

  await reader.cancel()
})

test("failing Source keeps Last known good and marks the Module Stale", async () => {
  const consoleError = spyOn(console, "error").mockImplementation(() => {})
  let failing = false
  const hub = createHub({
    modules: [
      defineModule({
        id: "flaky",
        span: 4,
        priority: 1,
        schedule: { every: 5 },
        fetch: () => {
          if (failing) throw new Error("source down")
          return "good"
        },
        render: (value) => <p>reading {value}</p>,
      }),
    ],
    effects,
  })
  const page = () =>
    hub.handle(new Request("http://localhost/")).then((r) => r.text())

  await Bun.sleep(50)
  expect(await page()).not.toContain("lucide-triangle-alert")

  failing = true
  await Bun.sleep(50)
  setSystemTime(Date.now() + 12 * 60_000)
  const stale = await page()
  setSystemTime()
  expect(stale).toContain("reading good")
  expect(stale).toContain("lucide-triangle-alert")
  expect(stale).toContain("12m ago")

  failing = false
  await Bun.sleep(50)
  expect(await page()).not.toContain("lucide-triangle-alert")
  consoleError.mockRestore()
})

test("tap runs the Module's Tap action and holds Pending until it settles", async () => {
  const consoleError = spyOn(console, "error").mockImplementation(() => {})
  const opened: string[] = []
  let settle = (_error?: Error) => {}
  const hub = createHub({
    modules: [
      defineModule({
        id: "tappable",
        span: 4,
        priority: 1,
        schedule: { every: 60_000 },
        fetch: () => "tappable",
        render: () => <p>tappable module</p>,
        tap: ({ ssh }) => ssh.open("https://example.com/"),
      }),
    ],
    effects: {
      ...effects,
      ssh: {
        ...effects.ssh,
        open: (url) => {
          opened.push(url)
          return new Promise((resolve, reject) => {
            settle = (error) => (error ? reject(error) : resolve())
          })
        },
      },
    },
  })
  await Bun.sleep(10)
  const tap = (id: string) =>
    hub.handle(new Request(`http://localhost/tap/${id}`, { method: "POST" }))
  const page = () =>
    hub.handle(new Request("http://localhost/")).then((r) => r.text())

  expect((await tap("unknown")).status).toBe(404)

  expect((await tap("tappable")).status).toBe(202)
  expect(opened).toEqual(["https://example.com/"])
  expect(await page()).toMatch(/id="module-tappable"[^>]*aria-busy="true"/)
  expect((await tap("tappable")).status).toBe(409)
  expect(opened).toHaveLength(1)

  settle()
  await Bun.sleep(0)
  expect(await page()).not.toContain("aria-busy")

  await tap("tappable")
  settle(new Error("ssh exited 255"))
  await Bun.sleep(0)
  const failed = await page()
  expect(failed).not.toContain("aria-busy")
  expect(failed).toContain("tap failed")
  consoleError.mockRestore()
})

test("light follows its HA state, toggles through `ha` and goes Stale while disconnected", async () => {
  const consoleError = spyOn(console, "error").mockImplementation(() => {})
  const calls: unknown[][] = []
  let watcher: PushSource<string> = {
    next: () => {},
    fail: () => {},
  }
  let settle = () => {}
  const hub = createHub({
    modules: [light],
    effects: {
      ...effects,
      ha: {
        watch: (_entityId, listener) => {
          watcher = listener
        },
        callService: (...call) => {
          calls.push(call)
          return new Promise((resolve) => {
            settle = resolve
          })
        },
      },
    },
  })
  const page = () =>
    hub.handle(new Request("http://localhost/")).then((r) => r.text())
  expect(await page()).not.toContain('id="module-light"')

  watcher.next("off")
  await Bun.sleep(0)
  expect(await page()).toContain(">OFF<")

  const tap = await hub.handle(
    new Request("http://localhost/tap/light", { method: "POST" }),
  )
  expect(tap.status).toBe(202)
  expect(calls).toEqual([
    ["homeassistant", "toggle", { entity_id: lightEntity }],
  ])
  expect(await page()).toMatch(/id="module-light"[^>]*aria-busy="true"/)

  watcher.next("on")
  settle()
  await Bun.sleep(0)
  const toggled = await page()
  expect(toggled).toContain(">ON<")
  expect(toggled).not.toContain("aria-busy")

  watcher.fail(new Error("websocket closed"))
  await Bun.sleep(0)
  expect(await page()).toContain("lucide-triangle-alert")
  consoleError.mockRestore()
})
