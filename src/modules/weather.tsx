import { defineModule } from "@/module"

const url = "https://weather.yahoo.co.jp/weather/jp/13/4410/13107.html"

type Cell = { text: string; icon: string; highlighted: boolean }

const firstNumber = (cell?: Cell) => Number(cell?.text.match(/-?[\d.]+/)?.[0])

// Pinpoint table rows: 時刻, 天気, 気温, 湿度, 降水量, 風向風速. Column 0 holds the row labels.
const toSlots = ([times = [], ...rows]: Cell[][]) =>
  times.slice(1).map((time, i) => {
    const [weather, temp, humidity, precipitation, wind] = rows.map(
      (row) => row[i + 1],
    )
    return {
      time: time.text.trim(),
      // Yahoo highlights the current slot onwards.
      upcoming: time.highlighted,
      icon: weather?.icon ?? "",
      label: weather?.text.trim() ?? "",
      temp: firstNumber(temp),
      humidity: firstNumber(humidity),
      precipitation: firstNumber(precipitation),
      wind: wind?.text.includes("静穏") ? 0 : firstNumber(wind),
    }
  })

const parse = (html: string) => {
  const days: Record<"today" | "tomorrow", Cell[][]> = {
    today: [],
    tomorrow: [],
  }
  const indices = { umbrella: "", clothing: "" }
  const rewriter = new HTMLRewriter()
  // #index-01 is today's tab; tomorrow's uses the same classes.
  for (const name of ["umbrella", "clothing"] as const)
    rewriter.on(`#index-01 .indexList_item-${name} .index_value`, {
      text: (chunk) => {
        indices[name] += chunk.text
      },
    })
  for (const [day, rows] of Object.entries(days)) {
    const table = `#yjw_pinpoint_${day} table`
    const cell = () => rows.at(-1)?.at(-1)
    rewriter
      .on(`${table} tr`, { element: () => void rows.push([]) })
      .on(`${table} td`, {
        element: (td) =>
          void rows.at(-1)?.push({
            text: "",
            icon: "",
            highlighted: td.getAttribute("bgcolor") === "#e9eefd",
          }),
        text: (chunk) => {
          const current = cell()
          if (current) current.text += chunk.text
        },
      })
      .on(`${table} td img`, {
        element: (img) => {
          const current = cell()
          if (current) current.icon = img.getAttribute("src") ?? ""
        },
      })
  }
  rewriter.transform(html)

  return {
    today: toSlots(days.today),
    tomorrow: toSlots(days.tomorrow),
    umbrella: Number(indices.umbrella.match(/\d+/)?.[0]),
    clothing: Number(indices.clothing.match(/\d+/)?.[0]),
  }
}

// Throws on any markup surprise so the Module goes Stale instead of showing garbage.
const scrape = async () => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Yahoo天気 responded ${response.status}`)
  const { today, tomorrow, umbrella, clothing } = parse(await response.text())

  const slots = [...today, ...tomorrow]
  const nowIndex = slots.findIndex((slot) => slot.upcoming)
  const now = slots[nowIndex]
  if (
    !now ||
    !today.length ||
    [umbrella, clothing].some(Number.isNaN) ||
    slots.some(
      ({ icon, temp, humidity, precipitation, wind }) =>
        !icon || [temp, humidity, precipitation, wind].some(Number.isNaN),
    )
  )
    throw new Error("unexpected Yahoo天気 markup")

  const temps = today.map((slot) => slot.temp)
  return {
    now,
    high: Math.max(...temps),
    low: Math.min(...temps),
    umbrella,
    clothing,
    forecasts: slots.slice(nowIndex + 1, nowIndex + 7),
  }
}

export const weather = defineModule({
  id: "weather",
  span: 4,
  priority: 40,
  schedule: { every: 10 * 60_000 },
  fetch: scrape,
  tap: ({ ssh }) => ssh.open(url),
  render: ({ now, high, low, umbrella, clothing, forecasts }) => (
    <div class="flex flex-col gap-3 rounded-xl bg-neutral-900 p-4">
      <div class="flex items-center gap-3">
        <img src={now.icon} alt={now.label} class="-mb-2 size-18" />
        <div>
          <div class="flex items-end gap-2">
            <p class="text-4xl leading-none font-semibold tabular-nums">
              {now.temp}°C
            </p>
          </div>
          <div>
            {low}°C / {high}°C
          </div>
        </div>
        <dl class="ml-auto grid grid-cols-[auto_auto] gap-x-4 text-sm tabular-nums">
          <dt class="text-neutral-400">湿度</dt>
          <dd>{now.humidity}%</dd>
          <dt class="text-neutral-400">風速</dt>
          <dd>{now.wind}m/s</dd>
          <dt class="text-neutral-400">傘指数</dt>
          <dd>{umbrella}%</dd>
          <dt class="text-neutral-400">衣指数</dt>
          <dd>{clothing}%</dd>
        </dl>
      </div>
      <ol class="flex justify-between text-center text-sm tabular-nums">
        {forecasts.map((slot) => (
          <li class="flex flex-col items-center">
            <span class="mb-1 text-neutral-400">{slot.time}</span>
            <img src={slot.icon} alt={slot.label} class="size-10" />
            <span>{slot.temp}°C</span>
          </li>
        ))}
      </ol>
    </div>
  ),
})
