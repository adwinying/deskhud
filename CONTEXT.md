# deskhud

A glanceable, always-current dashboard shown on a phone at the desk when Adwin is present. Taps on the dashboard act on the workstation.

## Language

### Devices

**Hub**:
The server on the NAS that owns all dashboard state and serves the dashboard.
_Avoid_: backend, server, NAS

**Kiosk**:
The docked phone running Fully Kiosk Browser that displays the dashboard.
_Avoid_: client, phone, display

**Workstation**:
The Mac (mayonaca) that tap actions run on.
_Avoid_: this machine, desktop, computer

### Dashboard

**Module**:
One self-contained section of the dashboard showing a single topic (weather, usage, trains, home). May be shown or hidden depending on context.
_Avoid_: widget, tile, card

**Priority**:
A Module's position in the dashboard order. A Module has a base Priority and may raise it while something needs attention (e.g. a train delay).
_Avoid_: order, rank, weight

**Stale**:
The condition of a Module showing its Last known good because its Source is currently failing.
_Avoid_: error, outdated, offline

**Source**:
An external system the Hub reads a Module's data from.
_Avoid_: provider, API, integration

**Last known good**:
The most recent successful reading from a Source, kept and shown when the Source currently fails.
_Avoid_: cache, fallback

**Tap action**:
Something a Module does when tapped on the Kiosk: opening a URL on the Workstation, or calling a Home Assistant service.
_Avoid_: click handler, action

**Pending**:
The condition of a Module between a Tap action being sent and its outcome being observed (or timing out).
_Avoid_: loading, in flight
