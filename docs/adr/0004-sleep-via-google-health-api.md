# Sleep read from the Google Health API, not Apple Health

The Hub reads sleep and HRV from the Google Health API, where the Fitbit Air syncs directly. Apple Health has no server API: the data would have to be pushed from the iPhone, and the existing Shortcut only writes to Notion at midnight, a day late, summing samples that may split a night at midnight. The Google Health API returns sessions with Fitbit's own `mainSleep` flag and a `minutesAsleep` summary that excludes awake time.

## Consequences

- All Google Health API scopes are restricted. The OAuth app stays unverified in production, which Google allows for personal use under 100 users, so refresh tokens don't expire after 7 days.
- Fitbit's readiness and sleep scores aren't in the API, so the Module shows HRV instead.
- Bun 1.3.9's `fetch` to `health.googleapis.com` hangs while `Bun.serve` runs; 1.4.0 fixes it.
