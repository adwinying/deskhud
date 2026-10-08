import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { co2 } from "@/modules/co2"

afterEach(() => mock.restore())

const module = co2("http://sensor.lan")

test("reads CO2 from the sensor's status 10", async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      StatusSNS: {
        Time: "1970-08-26T23:36:49",
        SCD40: {
          CarbonDioxide: 1234,
          eCO2: 1200,
          Temperature: 26.2,
          Humidity: 52.5,
        },
        TempUnit: "C",
      },
    }),
  )
  if (!("fetch" in module)) throw new Error("co2 must be scheduled")
  expect(await module.fetch()).toBe(1234)
})

test("shows only above 1,000ppm", () => {
  const now = new Date()
  expect(module.visible?.(1000, now)).toBe(false)
  expect(module.visible?.(1001, now)).toBe(true)
})
