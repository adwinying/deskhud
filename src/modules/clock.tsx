import dayjs from "dayjs"
import "dayjs/locale/ja"
import { defineModule } from "@/module"

// Ticks every second so the minute flips on time; the Hub only patches when the render changes.
export const clock = defineModule({
  id: "clock",
  span: 2,
  priority: 50,
  schedule: { every: 1000 },
  fetch: () => dayjs().locale("ja"),
  render: (now) => (
    <div class="flex flex-col items-center justify-center gap-1 rounded-xl bg-neutral-900 p-4">
      <p class="leading-none text-neutral-400">{now.format("MM月DD日(ddd)")}</p>
      <p class="text-5xl leading-none font-semibold tabular-nums">
        {now.format("HH:mm")}
      </p>
    </div>
  ),
})
