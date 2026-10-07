import { z } from "zod"
import type { Effects } from "@/module"

export const presenceEntity = "binary_sensor.workspace_presence"

// Fully answers 200 even when a command fails; `type=json` reports the outcome in `status`.
const Reply = z.object({ status: z.string(), statustext: z.string() })

const setScreen = async (adminUrl: string, on: boolean) => {
  const url = new URL(adminUrl)
  url.searchParams.set("cmd", on ? "screenOn" : "screenOff")
  url.searchParams.set("type", "json")
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  const { status, statustext } = Reply.parse(await response.json())
  if (status !== "OK")
    throw new Error(`Fully ${url.searchParams.get("cmd")}: ${statustext}`)
}

/** Keeps the Kiosk's screen on exactly while Presence is detected. */
export const syncPresence = (ha: Effects["ha"], adminUrl: string) =>
  ha.watch(presenceEntity, {
    next: (state) => {
      // e.g. "unavailable" while the sensor is offline: leave the screen as is.
      if (state !== "on" && state !== "off") return
      setScreen(adminUrl, state === "on").catch((error) =>
        console.error("presence:", error),
      )
    },
    fail: (error) => console.error("presence:", error),
  })
