# deskhud

A glanceable dashboard served by the Hub and shown on the Kiosk, a phone docked at the desk.

## Development

```bash
mise install
bun install
bun run dev
```

Open http://localhost:3000.

## Deployment (NAS)

CI publishes `ghcr.io/adwinying/deskhud:latest` on every push to `main`. After the first publish, set the package's visibility to public in its GitHub settings so the NAS can pull without logging in.

### 1. Env file

Configuration comes from env vars. Keep them in an env file in the NAS secrets directory, never in the repo or image:

```bash
# /path/to/secrets/deskhud.env
# Optional, defaults to 3000
PORT=3000
# Tap actions: SSH destination of the Workstation, and the mounted key and known_hosts
WORKSTATION_SSH=adwin@mayonaca
SSH_KEY=/secrets/ssh/id_ed25519
SSH_KNOWN_HOSTS=/secrets/ssh/known_hosts
# Workspace light: Home Assistant base URL and a long-lived access token (HA profile → Security)
HA_URL=http://homeassistant.lan:8123
HA_TOKEN=eyJ...
# AI usage, as label:value lists: `claude setup-token` tokens, and mounted Codex auth.json paths (step 5)
CLAUDE_TOKENS=personal:sk-ant-oat01-...,work:sk-ant-oat01-...
CODEX_AUTHS=personal:/secrets/codex/personal/auth.json,work:/secrets/codex/work/auth.json
# Tasks: TickTick Open API access token (step 6)
TICKTICK_TOKEN=...
# Sleep: Google Health API OAuth client and refresh token (step 7)
GOOGLE_HEALTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_HEALTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_HEALTH_REFRESH_TOKEN=1//...
# Calendar: a banner from an hour before each event until 10 minutes in, as label:refreshToken per account (step 8)
GOOGLE_CALENDAR_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=GOCSPX-...
GOOGLE_CALENDAR_TOKENS=personal:1//...,work:1//...
# CO2: Tasmota device with an SCD40; a banner tops the dashboard above 1,000ppm
CO2_SENSOR_URL=http://192.168.5.5
# Threads: a banner when a T3 Code thread needs attention, as label:url|token per machine. Each machine's
# T3 Connect URL and its own token from `t3 auth session issue --label deskhud --token-only` (tokens don't
# carry across machines; admin scope; revoke with `t3 auth session revoke`)
T3CODE_ENVIRONMENTS=mayonaca:https://prod-....t3coderelay.com|...,crefil:https://prod-....t3coderelay.com|...
```

`src/env.ts` validates these at startup. Omit a whole group to disable its feature; a partial group fails startup.

Add each Module's secrets here as Modules that need them land.

### 2. Run the container

```bash
docker run -d --name deskhud --restart unless-stopped \
  --env-file /path/to/secrets/deskhud.env \
  -v /path/to/secrets/deskhud-ssh:/secrets/ssh:ro \
  -v /path/to/secrets/deskhud-codex:/secrets/codex \
  -p 3000:3000 \
  ghcr.io/adwinying/deskhud:latest
```

The container side of `-p` (right) must match `PORT`.

To update:

```bash
docker pull ghcr.io/adwinying/deskhud:latest
docker rm -f deskhud
# then re-run the command above
```

### 3. Reverse proxy

Add an entry in the existing reverse proxy that forwards a LAN hostname (e.g. `deskhud.lan`) to `http://<nas-host>:3000`:

- Restrict it to LAN clients. The Hub has no authentication.
- Disable response buffering and read timeouts for `/events`. It is a long-lived SSE stream.

Point Fully Kiosk Browser's start URL at that hostname.

### 4. Workstation (Tap actions)

Tap actions open URLs and control media on the Workstation over SSH, with a key that can only run `open` on `https://` URLs and fixed `media-control` commands (ADR 0002).

1. On the NAS, create the key and pin the Workstation's host key. Use the tailnet IP rather than the MagicDNS name, which the container may not resolve. The container runs as `nobody` (uid 65534), and ssh refuses a key readable by others:

   ```bash
   mkdir /path/to/secrets/deskhud-ssh && cd /path/to/secrets/deskhud-ssh
   ssh-keygen -t ed25519 -N '' -C deskhud -f id_ed25519
   ssh-keyscan mayonaca > known_hosts
   sudo chown 65534:65534 id_ed25519 && chmod 600 id_ed25519
   ```

2. On the Workstation, enable System Settings → General → Sharing → Remote Login, and allow only your user.

3. Append one line to `~/.ssh/authorized_keys` on the Workstation, replacing the key with `id_ed25519.pub`:

   ```
   restrict,from="<NAS tailnet IP>",command="case \"$SSH_ORIGINAL_COMMAND\" in https://*) exec /usr/bin/open \"$SSH_ORIGINAL_COMMAND\";; t3code) exec /usr/bin/open -b com.t3tools.t3code;; media-toggle) exec /opt/homebrew/bin/media-control toggle-play-pause;; media-previous) exec /opt/homebrew/bin/media-control previous-track;; media-next) exec /opt/homebrew/bin/media-control next-track;; media-stream) exec /opt/homebrew/bin/media-control stream --micros 2>/dev/null;; *) exit 1;; esac" ssh-ed25519 AAAA... deskhud
   ```

   `open` needs a logged-in GUI session. The `media-*` commands need `media-control` (step 9).

4. In the tailnet policy, allow only the NAS to reach the Workstation on tcp:22:

   ```json
   "grants": [{ "src": ["nas"], "dst": ["mayonaca"], "ip": ["tcp:22"] }]
   ```

   Don't enable Tailscale SSH on the Workstation: it ignores `authorized_keys`.

5. Check from the NAS: `docker exec deskhud ssh -i /secrets/ssh/id_ed25519 -o UserKnownHostsFile=/secrets/ssh/known_hosts adwin@mayonaca https://example.com` opens the page, `t3code` brings T3 Code to the front, `media-toggle` plays or pauses, and anything else fails.

### 5. AI usage

Both logins belong to the NAS alone (ADR 0003). Never copy the Workstation's credentials: refresh tokens are single-use, so sharing one logs a side out.

Each account is its own Module. List accounts as `label:value` pairs separated by commas; the label is shown on the Module. Either list may be omitted.

1. Claude: run `claude setup-token` once per account and add each token to `CLAUDE_TOKENS`. Each probe costs about one token; none are sent while a limit is hit.
2. Codex: log each account in on the NAS into its own `CODEX_HOME`, then add its `auth.json` to `CODEX_AUTHS`. The Hub rewrites `auth.json` on every token refresh, so the mount stays writable and owned by `nobody`:

   ```bash
   label=personal
   mkdir -p /path/to/secrets/deskhud-codex/$label
   docker run --rm -it -v /path/to/secrets/deskhud-codex/$label:/codex -e CODEX_HOME=/codex node:22 npx -y @openai/codex login --device-auth
   sudo chown -R 65534:65534 /path/to/secrets/deskhud-codex && chmod 600 /path/to/secrets/deskhud-codex/*/auth.json
   ```

   Afterwards, check that `codex` on the Workstation is still logged in. If not, Codex usage has to move to a fetch over the SSH channel from ADR 0002.

### 6. Tasks

The Tasks Module counts TickTick's Today view through the Open API, which needs a one-off OAuth login.

1. At https://developer.ticktick.com/manage, create an app with the redirect URL `http://localhost`.
2. Open this URL in a browser and approve. The redirect fails to load; copy `code` from its address bar:

   ```
   https://ticktick.com/oauth/authorize?client_id=<client_id>&scope=tasks:read&state=deskhud&redirect_uri=http://localhost&response_type=code
   ```

3. Exchange the code and put `access_token` in `TICKTICK_TOKEN`:

   ```bash
   curl -u '<client_id>:<client_secret>' https://ticktick.com/oauth/token \
     -d grant_type=authorization_code -d scope=tasks:read -d redirect_uri=http://localhost -d code=<code>
   ```

The response has no refresh token. Once the token expires, the Module goes Stale; repeat steps 2–3.

### 7. Sleep

The Sleep Module reads last night's main sleep and HRV from the Google Health API (ADR 0004). It shows from the morning's sync until the day ends.

Run `scripts/google-health-setup.sh` on the Workstation. It walks through the Cloud project and OAuth client, gets a refresh token and writes the three `GOOGLE_HEALTH_*` values to `.env`. Copy them into `deskhud.env`.

Keep the app **In production** but unverified: in Testing, refresh tokens expire after 7 days. A token unused for 6 months also expires; then re-run the script.

### 8. Calendar

The Calendar Module shows timed events from each account's primary calendar, skipping all-day and declined ones. Tapping opens the first event in the Workstation's browser, signed in as the event's account.

Run `scripts/google-calendar-setup.sh` on the Workstation after step 7. It adds the Calendar API to the same Cloud project and OAuth client, authorizes each account and writes the three `GOOGLE_CALENDAR_*` values to `.env`. Copy them into `deskhud.env`.

### 9. Now Playing

The Media Module shows the Workstation's Now Playing app, like the iOS lock screen player, while it plays and for 5 minutes after pausing. Tapping the card plays or pauses; the side buttons skip. It only appears when the Tap action group (step 4) is set.

On the Workstation, install [media-control](https://github.com/ungive/media-control), which reads Now Playing through Perl's entitlement since macOS 15.4 locked the private API:

```bash
brew install media-control
media-control test
```
