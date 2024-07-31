# Sway Toggl

This is some helpful utilities for sway and toggl track, namely it does:

1. Send a tracking reminder at a regular interval if you're not tracking your
   time. By default this is every 5 minutes but can be configured (see below)
2. Send timeline data to toggl's API, based on what you've got focused in sway.
   So in case you forgot to track you can figure it out based on what you were
   doing on your computer.
3. Print waybar custom module compatible json so you can show if/what you're
   tracking.
   Example module:
   ```json
   {
     "custom/toggl": {
       "format": "󰐥",
       "return-type": "json",
       "exec": "node /home/sbe/test/sway-toggl/dist/index.js",
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

## Configuration

This module uses the same `.togglrc` as <https://toggl.uhlir.dev/>, placed
either in `~/.togglrc` or in the XDG config directory (most likely
`~/.config/.togglrc`).

You need to set an authentication method in the `[auth]` section, either
`api_token`, or `username` and `password`. This can also be provided with ENV
variables `TOGGL_API_TOKEN`, `TOGGL_USERNAME`, and `TOGGL_PASSWORD`
respectively.

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
