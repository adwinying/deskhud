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
```

Add each Module's secrets here as Modules that need them land.

### 2. Run the container

```bash
docker run -d --name deskhud --restart unless-stopped \
  --env-file /path/to/secrets/deskhud.env \
  -v /path/to/secrets/deskhud-ssh:/secrets/ssh:ro \
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

Tap actions open URLs on the Workstation over SSH, with a key that can only run `open` on `https://` URLs (ADR 0002).

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
   restrict,from="<NAS tailnet IP>",command="case \"$SSH_ORIGINAL_COMMAND\" in https://*) exec /usr/bin/open \"$SSH_ORIGINAL_COMMAND\";; *) exit 1;; esac" ssh-ed25519 AAAA... deskhud
   ```

   `open` needs a logged-in GUI session.

4. In the tailnet policy, allow only the NAS to reach the Workstation on tcp:22:

   ```json
   "grants": [{ "src": ["nas"], "dst": ["mayonaca"], "ip": ["tcp:22"] }]
   ```

   Don't enable Tailscale SSH on the Workstation: it ignores `authorized_keys`.

5. Check from the NAS: `docker exec deskhud ssh -i /secrets/ssh/id_ed25519 -o UserKnownHostsFile=/secrets/ssh/known_hosts adwin@mayonaca https://example.com` opens the page; any non-`https://` command fails.
