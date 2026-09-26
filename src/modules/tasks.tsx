import dayjs from "dayjs"
import { z } from "zod"
import { defineModule } from "@/module"
import { brands } from "@/modules/brands"

const api = "https://api.ticktick.com/open/v1"
const todayView = "https://ticktick.com/webapp/#q/today/tasks"

// Undated tasks have no startDate and never show in the Today view.
const Tasks = z.array(z.object({ startDate: z.string().optional() }))

const format = (date: dayjs.Dayjs) => date.format("YYYY-MM-DDTHH:mm:ss.SSSZZ")

const post = async (path: string, token: string, body: object) => {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    // A hung request would otherwise stall the schedule without ever going Stale.
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new Error(`TickTick ${path} responded ${response.status}`)
  return Tasks.parse(await response.json())
}

// Mirrors the Today view: open tasks starting today or overdue, and those completed today.
const fetchToday = async (token: string) => {
  const now = dayjs()
  const endOfDay = now.endOf("day")
  const [open, completed] = await Promise.all([
    post("/task/filter", token, { endDate: format(endOfDay), status: [0] }),
    post("/task/completed", token, {
      startDate: format(now.startOf("day")),
      endDate: format(now),
    }),
  ])
  const done = completed.filter(
    ({ startDate }) => startDate && Date.parse(startDate) <= endOfDay.valueOf(),
  ).length
  return { remaining: open.length, done }
}

// A 270° ring with the gap at the bottom, like the Apple Watch Reminders complication.
export const tasks = (token: string) =>
  defineModule({
    id: "tasks",
    span: 1,
    priority: 47,
    schedule: { every: 2 * 60_000 },
    fetch: () => fetchToday(token),
    tap: ({ ssh }) => ssh.open(todayView),
    render: ({ remaining, done }) => {
      // Nothing left, even with nothing done, reads as a closed ring.
      const progress = remaining ? done / (done + remaining) : 1
      return (
        <div
          class="flex h-full items-center rounded-xl bg-neutral-900 p-2"
          role="img"
          aria-label={`今日のタスク 残り${remaining}件`}
        >
          <div class="relative w-full">
            <svg viewBox="0 0 100 100" class="w-full" aria-hidden="true">
              <g
                transform="rotate(135 50 50)"
                fill="none"
                stroke-width="10"
                stroke-linecap="round"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  pathLength="100"
                  stroke-dasharray="75 100"
                  class="stroke-neutral-800"
                />
                {progress > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    pathLength="100"
                    stroke-dasharray={`${75 * progress} 100`}
                    stroke="#4772FA"
                  />
                )}
              </g>
            </svg>
            <p class="absolute inset-0 flex items-center justify-center text-2xl font-semibold tabular-nums">
              {remaining}
            </p>
            {/* Sits in the ring's gap. */}
            <span class="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs">
              {brands.TickTick}
            </span>
          </div>
        </div>
      )
    },
  })
