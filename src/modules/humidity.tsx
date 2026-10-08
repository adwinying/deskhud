import { Droplet } from "lucide-static"
import { icon } from "@/icon"
import { defineModule } from "@/module"
import { readScd40 } from "@/modules/co2"

const threshold = 35

export const humidity = (sensorUrl: string) =>
  defineModule({
    id: "humidity",
    span: 4,
    // Just below CO₂.
    priority: 195,
    schedule: { every: 60_000 },
    fetch: async () => (await readScd40(sensorUrl)).Humidity,
    visible: (percent) => percent < threshold,
    render: (percent) => (
      <p class="flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2 font-semibold text-black">
        {icon(Droplet)} 湿度 {Math.round(percent)}% — 加湿してください
      </p>
    ),
  })
