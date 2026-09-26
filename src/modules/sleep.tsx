import dayjs from "dayjs"
import {
  BedDouble,
  ChevronDown,
  ChevronUp,
  Minus,
  SquareActivity,
} from "lucide-static"
import { z } from "zod"
import { authorize, type Credentials } from "@/google"
import { icon } from "@/icon"
import { defineModule } from "@/module"

const api = "https://health.googleapis.com/v4/users/me/dataTypes"

// A hung request would otherwise stall the schedule without ever going Stale.
const timeout = () => AbortSignal.timeout(30_000)

// int64 fields arrive as strings.
const numeric = z.string().min(1).transform(Number).pipe(z.number())

// Empty results omit `dataPoints`. Both lists come newest first.
const Sleeps = z.object({
  dataPoints: z
    .array(
      z.object({
        sleep: z.object({
          interval: z.object({ endTime: z.string() }),
          metadata: z.object({ mainSleep: z.boolean().optional() }),
          // Absent until Fitbit has processed the session.
          summary: z.object({ minutesAsleep: numeric }).optional(),
        }),
      }),
    )
    .default([]),
})

const Hrvs = z.object({
  dataPoints: z
    .array(
      z.object({
        dailyHeartRateVariability: z.object({
          date: z.object({
            year: z.number(),
            month: z.number(),
            day: z.number(),
          }),
          averageHeartRateVariabilityMilliseconds: z.number(),
        }),
      }),
    )
    .default([]),
})

const list = async <T extends z.ZodType>(
  type: string,
  filter: string,
  token: string,
  schema: T,
) => {
  const url = new URL(`${api}/${type}/dataPoints`)
  url.searchParams.set("filter", filter)
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: timeout(),
  })
  if (!response.ok)
    throw new Error(`Google Health ${type} responded ${response.status}`)
  return schema.parse(await response.json()) as z.output<T>
}

const day = (date: dayjs.ConfigType) => dayjs(date).format("YYYY-MM-DD")

const change = (
  current?: number,
  previous?: number,
  round = (n: number) => n,
) =>
  current === undefined || previous === undefined
    ? undefined
    : round(current - previous)

// The last two main sleeps (naps excluded) and the HRV measured during the latest.
const fetchNight = async (credentials: Credentials) => {
  const token = await authorize(credentials)
  const since = day(dayjs().subtract(3, "day"))
  const [sleeps, hrvs] = await Promise.all([
    list("sleep", `sleep.interval.civil_end_time >= "${since}"`, token, Sleeps),
    list(
      "daily-heart-rate-variability",
      `daily_heart_rate_variability.date >= "${since}"`,
      token,
      Hrvs,
    ),
  ])
  const [night, previousNight] = sleeps.dataPoints.flatMap(({ sleep }) =>
    sleep.metadata.mainSleep && sleep.summary
      ? [
          {
            date: day(sleep.interval.endTime),
            wokeAt: Date.parse(sleep.interval.endTime),
            minutes: sleep.summary.minutesAsleep,
          },
        ]
      : [],
  )
  if (!night) return undefined
  const hrvIndex = hrvs.dataPoints.findIndex(
    ({ dailyHeartRateVariability: { date } }) =>
      day(new Date(date.year, date.month - 1, date.day)) === night.date,
  )
  const hrvAt = (index: number) =>
    hrvIndex < 0
      ? undefined
      : hrvs.dataPoints[index]?.dailyHeartRateVariability
          .averageHeartRateVariabilityMilliseconds
  const hrv = hrvAt(hrvIndex)
  return {
    date: night.date,
    wokeAt: night.wokeAt,
    minutes: night.minutes,
    minutesChange: change(night.minutes, previousNight?.minutes),
    hrv,
    // Rounded as shown, so a tiny change never reads as ▲0.0.
    hrvChange: change(
      hrv,
      hrvAt(hrvIndex + 1),
      (ms) => Math.round(ms * 10) / 10,
    ),
  }
}

const duration = (minutes: number) =>
  minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`

// Direction only, no good/bad colour: one day's change says little on its own.
const Change = ({
  by,
  format,
}: {
  by?: number
  format: (n: number) => string
}) =>
  by === undefined ? null : (
    <span class="inline-flex items-center gap-0.5 text-neutral-400">
      {icon(by > 0 ? ChevronUp : by < 0 ? ChevronDown : Minus)}
      {format(Math.abs(by))}
    </span>
  )

const Stat = ({
  icon: svg,
  label,
  value,
  children,
}: {
  icon: string
  label: string
  value: string
  children?: JSX.Element
}) => (
  <div class="flex flex-col">
    <p class="flex items-center gap-1 text-sm text-neutral-400">
      <span class="text-purple-700">{icon(svg)}</span> {label}
    </p>
    <p class="flex items-end gap-2 text-xs">
      <span class="text-2xl font-semibold">{value}</span>
      {children}
    </p>
  </div>
)

const priority = { waking: 44, evening: 29 }
const fade = 12 * 3_600_000

export const sleep = (credentials: Credentials) =>
  defineModule({
    id: "sleep",
    span: 4,
    priority: priority.waking,
    // Sinks from above the weather at waking to the bottom by evening; the next night resets it.
    effectivePriority: (night, now) =>
      night
        ? priority.waking -
          (priority.waking - priority.evening) *
            Math.min(Math.max((now.getTime() - night.wokeAt) / fade, 0), 1)
        : priority.waking,
    // Fitbit processes a night some time after waking.
    schedule: { every: 15 * 60_000 },
    fetch: () => fetchNight(credentials),
    // Hidden until this morning's sleep arrives, so an old night never reads as last night.
    visible: (night, now) => night?.date === day(now),
    // `visible` never lets an empty night through.
    render: (night) =>
      night ? (
        <div class="grid grid-cols-2 gap-4 rounded-xl bg-neutral-900 p-4 leading-none whitespace-nowrap tabular-nums">
          <Stat icon={BedDouble} label="睡眠" value={duration(night.minutes)}>
            <Change by={night.minutesChange} format={duration} />
          </Stat>
          {night.hrv !== undefined && (
            <Stat
              icon={SquareActivity}
              label="HRV"
              value={`${night.hrv.toFixed(1)}ms`}
            >
              <Change
                by={night.hrvChange}
                format={(ms) => `${ms.toFixed(1)}ms`}
              />
            </Stat>
          )}
        </div>
      ) : (
        ""
      ),
  })
