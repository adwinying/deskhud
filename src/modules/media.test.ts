import { expect, test } from "bun:test"
import { active, apply, media, type Media } from "@/modules/media"

const now = Date.parse("2026-09-26T12:00:00Z")
const event = (diff: boolean, payload: object) =>
  JSON.stringify({ type: "data", diff, payload })

test("merges diffs into the last full payload and resets on the next", () => {
  let state: Media = {}
  state = apply(state, event(false, { title: "Station", playing: false }))
  state = apply(state, event(true, { playing: true, bundleIdentifier: "x" }))
  expect(state).toEqual({ title: "Station", playing: true })
  expect(apply(state, event(false, {}))).toEqual({})
})

test("shows while playing and for a while after pausing", () => {
  const at = (ago: number) => (now - ago) * 1000
  expect(active({ title: "t", playing: true }, now)).toBe(true)
  expect(
    active(
      { title: "t", playing: false, timestampEpochMicros: at(60_000) },
      now,
    ),
  ).toBe(true)
  expect(
    active(
      { title: "t", playing: false, timestampEpochMicros: at(600_000) },
      now,
    ),
  ).toBe(false)
  expect(active({ playing: true }, now)).toBe(false)
})

test("escapes titles and only draws progress for a known duration", async () => {
  const html = await media.render({ title: "<b>x</b>", playing: true })
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
  expect(html).not.toContain("data-on-interval")
  expect(
    await media.render({ title: "t", durationMicros: 200_000_000 }),
  ).toContain("data-on-interval")
})
