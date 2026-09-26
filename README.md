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
```

Add each Module's secrets here as Modules that need them land.

### 2. Run the container

```bash
docker run -d --name deskhud --restart unless-stopped \
  --env-file /path/to/secrets/deskhud.env \
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
