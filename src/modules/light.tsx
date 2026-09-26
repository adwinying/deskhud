import { Spotlight } from "lucide-static"
import { icon } from "@/icon"
import { defineModule } from "@/module"

export const lightEntity = "switch.workspace_front"

// HA state: "on", "off", or e.g. "unavailable" when the light can't be reached.
export const light = defineModule<string>({
  id: "light",
  span: 1,
  priority: 46,
  subscribe: ({ ha }, source) => ha.watch(lightEntity, source),
  tap: ({ ha }) =>
    ha.callService("homeassistant", "toggle", { entity_id: lightEntity }),
  render: (state) => (
    <div
      class={`flex h-full flex-col items-center justify-center gap-1 rounded-xl p-4 ${state === "on" ? "bg-amber-300 text-black" : "bg-neutral-900 text-neutral-400"}`}
    >
      <p class="text-4xl">{icon(Spotlight)}</p>
      <p class="text-sm font-semibold">
        {state === "on" || state === "off" ? state.toUpperCase() : state}
      </p>
    </div>
  ),
})
