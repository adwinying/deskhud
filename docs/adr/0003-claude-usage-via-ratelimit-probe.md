# Claude usage read from rate-limit headers of a probe request

The Hub reads Claude subscription usage from the `anthropic-ratelimit-unified-5h-*` / `-7d-*` response headers of a 1-token Haiku request, authenticated with a long-lived `claude setup-token` stored on the NAS. The official usage endpoint (`/api/oauth/usage`) needs the `user:profile` scope, which setup-tokens lack. Copying the Mac's OAuth credentials to the NAS would break the Mac's login, because refresh tokens are single-use. The headers are undocumented and may change. Each probe costs about one token of quota.

## Consequences

- Once status is `rejected` or utilization hits 100%, the Hub stops probing until the reset time. Otherwise, with extra usage enabled, probes would be billed as overage.
- Codex gets its own `codex login --device-auth` on the NAS for the same reason. If that logs out the Mac, move Codex usage to a fetch over the SSH channel from ADR 0002.
