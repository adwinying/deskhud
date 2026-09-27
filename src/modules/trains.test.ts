import { expect, test } from "bun:test"
import type { Effects } from "@/module"
import { trains } from "@/modules/trains"

const disruption = { id: 128, line: "都営浅草線", status: "遅延", message: "" }

const tap = async (action?: string) => {
  const opened: string[] = []
  const effects = {
    ssh: { open: async (url: string) => void opened.push(url) },
  } as Effects
  await trains.tap?.(effects, [disruption], action)
  return opened
}

test("opens the tapped line, or the first disruption outside an entry", async () => {
  expect(await tap("40")).toEqual(["https://transit.yahoo.co.jp/diainfo/40/0"])
  expect(await tap()).toEqual(["https://transit.yahoo.co.jp/diainfo/128/0"])
})

test("rejects IDs outside the watched lines", async () => {
  await expect(tap("1")).rejects.toThrow()
})
