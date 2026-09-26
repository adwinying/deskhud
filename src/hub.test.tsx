import { expect, setSystemTime, spyOn, test } from "bun:test"
import { createHub } from "@/hub"
import { defineModule } from "@/module"

const effects = {
  ssh: { open: async () => {} },
  ha: { callService: async () => {} },
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
  expect(await page()).not.toContain("⚠")

  failing = true
  await Bun.sleep(50)
  setSystemTime(Date.now() + 12 * 60_000)
  const stale = await page()
  setSystemTime()
  expect(stale).toContain("reading good")
  expect(stale).toContain("⚠ 12m ago")

  failing = false
  await Bun.sleep(50)
  expect(await page()).not.toContain("⚠")
  consoleError.mockRestore()
})
