# Server-owned state pushed over Datastar SSE

The Hub owns all dashboard state and pushes Module patches to the Kiosk over SSE using Datastar. The Kiosk holds no state of its own. We rejected a Bun + Elysia + React SPA: the dashboard has no client-side state, only server data that must reach the screen as soon as it changes, so a client app would add a second render path and an API layer for nothing. We also rejected htmx polling because it can't push changes the moment they happen. The BETH stack's Turso was dropped because nothing needs persisting beyond the in-memory state.

## Consequences

- Every Kiosk (re)connect receives a full snapshot, then per-Module patches. Nothing relies on resuming a stream.
- Long-lived SSE needs Bun's idle timeout disabled or heartbeats, `openWhenHidden: true`, and a raised `retryMaxCount`.
