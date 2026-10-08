import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { humidity } from "@/modules/humidity"

afterEach(() => mock.restore())

const module = humidity("http://sensor.lan")

test("reads humidity from the sensor's status 10", async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      StatusSNS: {
        Time: "1970-09-08T04:59:02",
        SCD40: {
          CarbonDioxide: 587,
          eCO2: 586,
          Temperature: 25.8,
          Humidity: 52.5,
          DewPoint: 15.3,
        },
        TempUnit: "C",
      },
    }),
  )
  if (!("fetch" in module)) throw new Error("humidity must be scheduled")
  expect(await module.fetch()).toBe(52.5)
})

test("shows only below 35%", () => {
  const now = new Date()
  expect(module.visible?.(35, now)).toBe(false)
  expect(module.visible?.(34.9, now)).toBe(true)
})
