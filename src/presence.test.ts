import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { PushSource } from "@/module"
import { presenceEntity, syncPresence } from "@/presence"

afterEach(() => mock.restore())

const watched = () => {
  let source: PushSource<string> | undefined
  syncPresence(
    {
      watch: (entityId, s) => {
        expect(entityId).toBe(presenceEntity)
        source = s
      },
      callService: async () => {},
    },
    "http://kiosk.lan:2323/?password=secret",
  )
  if (!source) throw new Error("presence must watch HA")
  return source
}

test("turns the Kiosk's screen on and off with Presence", async () => {
  const ok = () => Response.json({ status: "OK", statustext: "" })
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(ok())
    .mockResolvedValueOnce(ok())
  const source = watched()
  source.next("on")
  source.next("off")
  source.next("unavailable")
  await Bun.sleep(0)
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    "http://kiosk.lan:2323/?password=secret&cmd=screenOn&type=json",
    "http://kiosk.lan:2323/?password=secret&cmd=screenOff&type=json",
  ])
})

test("logs Fully's errors, which arrive as 200s", async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ status: "Error", statustext: "Please login" }),
  )
  const error = spyOn(console, "error").mockImplementation(() => {})
  watched().next("on")
  await Bun.sleep(0)
  expect(String(error.mock.calls[0]?.[1])).toContain("Please login")
})
