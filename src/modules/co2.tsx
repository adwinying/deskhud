import { TriangleAlert } from "lucide-static"
import { z } from "zod"
import { icon } from "@/icon"
import { defineModule } from "@/module"

const threshold = 1000

// Tasmota's `status 10` sensor reading from its SCD40.
const Status = z.object({
  StatusSNS: z.object({
    SCD40: z.object({ CarbonDioxide: z.number(), Humidity: z.number() }),
  }),
})

export const readScd40 = async (sensorUrl: string) => {
  const response = await fetch(`${sensorUrl}/cm?cmnd=status%2010`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`CO2 sensor responded ${response.status}`)
  return Status.parse(await response.json()).StatusSNS.SCD40
}

export const co2 = (sensorUrl: string) =>
  defineModule({
    id: "co2",
    span: 4,
    // Above everything, including a train delay.
    priority: 200,
    schedule: { every: 60_000 },
    fetch: async () => (await readScd40(sensorUrl)).CarbonDioxide,
    visible: (ppm) => ppm > threshold,
    render: (ppm) => (
      <p class="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2 font-semibold text-white">
        {icon(TriangleAlert)} CO₂ {ppm.toLocaleString()}ppm — 換気してください
      </p>
    ),
  })
