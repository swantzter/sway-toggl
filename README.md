# Sway Toggl

This is some helpful utilities for sway (and other wayland compositors, like
jay) and toggl track, namely it does:

1. Send a tracking reminder at a regular interval if you're not tracking your
   time. By default this is every 5 minutes but can be configured (see below)
2. Send timeline data to toggl's API, based on what you've got focused in your
   compositor. So in case you forgot to track you can figure it out based on
   what you were doing on your computer.
3. Print waybar custom module compatible json so you can show if/what you're
   tracking.

## Running

It runs in two parts, picked with `--mode`:

- `--mode daemon` does the actual work: reminders, timeline data and idle
  detection. Run exactly one per session, a systemd user unit works well:
  ```ini
  # ~/.config/systemd/user/sway-toggl.service
  [Unit]
  Description=Toggl Track reminders and timeline
  PartOf=graphical-session.target
  After=graphical-session.target
  Requisite=graphical-session.target

  [Service]
  ExecStart=/usr/bin/env node %h/path/to/sway-toggl/dist/index.js --mode=daemon
  Restart=on-failure

  [Install]
  WantedBy=graphical-session.target
  ```
  and `systemctl --user enable --now sway-toggl.service`. A second daemon
  refuses to start.
- `--mode waybar` (the default) and `--mode ironbar` are the bar modules. They
  only show what the daemon publishes on `$XDG_RUNTIME_DIR/sway-toggl.sock`, so
  it's fine that waybar starts one copy per output. If the daemon isn't running
  the module says so in its tooltip.

  Example waybar module:
  ```json
  {
    "custom/toggl": {
      "format": "󰐥",
      "return-type": "json",
      "exec": "node /path/to/sway-toggl/dist/index.js",
      "on-click": "xdg-open https://track.toggl.com",
      "escape": true
    },
  }
  ```
  and suggested css:
  ```css
  #custom-toggl {
    padding: 0 10px 0 8px;
    margin: 0 0px;
    color: @cl_fore;
  }
  #custom-toggl.disabled {
    background-color: @cl_urge;
    color: @cl_fore;
  }
  ```

## Compositor support

There are two backends for figuring out what you have focused, selected with
`--backend`:

- `sway` uses the sway IPC socket, and works on sway (and anything else that
  implements its IPC protocol).
- `wlr` talks the wayland `zwlr_foreign_toplevel_manager_v1` protocol directly
  to the compositor, and works on [jay](https://github.com/mahkoh/jay) and most
  other wlroots-based compositors.

The default is `--backend auto` which picks `sway` if `SWAYSOCK` is set and
`wlr` otherwise, so usually you don't need to pass anything.

Idle detection uses the `ext-idle-notify-v1` wayland protocol in both cases,
which sway (>= 1.8), jay and most wlroots-based compositors implement. You count
as idle after 2 minutes without input, unless something holds an idle
inhibitor (a video, or a call with something like `sway-audio-idle-inhibit`
running). Time the machine spends suspended is recorded as idle too.

### Jay

Jay only advertises the foreign-toplevel and idle-notify protocols to clients
that have been granted the corresponding capabilities. The daemon names its
process `sway-toggl`, so add a client rule to your jay config
(`~/.config/jay/config.toml`):

```toml
[[clients]]
match.comm = "sway-toggl"
capabilities = ["foreign-toplevel-manager", "idle-notifier"]
```

Any process can call itself `sway-toggl`, so this keeps the capabilities away
from every other node process rather than being a security boundary. Jay's
connection tags are the strict alternative, if you start the daemon from jay.

## Configuration

This module uses the same `.togglrc` as <https://toggl.uhlir.dev/>, placed
either in `~/.togglrc` or in the XDG config directory (most likely
`~/.config/.togglrc`).

You need to set an authentication method in the `[auth]` section, either
`api_token`, or `username` and `password`. This can also be provided with ENV
variables `TOGGL_API_TOKEN`, `TOGGL_USERNAME`, and `TOGGL_PASSWORD`
respectively, in the daemon's environment (`Environment=` in the unit above).
Only the daemon reads the config, the bar modules don't need it.

You can also configure `idle_notify_interval_seconds` and under the `[options]`
section to tweak how often the notification is sent when you're not tracking.

This script will also add a `desktop_id` UUID under the `[options]` section,
this is needed to attribute your timeline data to the right device.

So, for example

```ini
[auth]
api_token = asdasdasda

[options]
desktop_id = 733a53e7-9311-4975-a276-bdacff742f57
idle_notify_interval_seconds = 300
```
