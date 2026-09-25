# Tap actions reach the Workstation via a forced SSH command

To open a URL on mayonaca, the Hub SSHes in through macOS Remote Login using a key restricted in `authorized_keys` to an inline forced command that only runs `open` on `https://` URLs. The Kiosk sends a Tap action ID and the Hub maps it to a URL. This keeps the whole deployment on the NAS: the Workstation needs only Remote Login, one `authorized_keys` line, and a tailnet grant allowing NAS → mayonaca:22.

## Considered Options

- **Agent daemon on the Mac**: rejected, as it's a second deployable to maintain.
- **Tailscale SSH with ACLs**: rejected. ACLs can't restrict commands, and Tailscale SSH ignores `authorized_keys`, so a compromised Hub would get a full shell.
