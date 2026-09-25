import { expect, test } from "bun:test"
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
