import { parseArgs } from 'node:util'

const args = parseArgs({
  options: {
    mode: {
      type: 'string',
      default: 'waybar',
    },
    backend: {
      type: 'string',
      default: 'auto',
    },
  },
})

const mode = args.values.mode
if (mode === 'daemon') {
  // compositors like jay grant privileged protocols by matching on
  // /proc/<pid>/comm, which would otherwise be "node". This has to happen
  // before anything connects to the compositor.
  process.title = 'sway-toggl'
  const { startDaemon } = await import('./daemon.js')
  await startDaemon(args.values.backend)
} else if (mode === 'waybar' || mode === 'ironbar') {
  const { startBar } = await import('./bar.js')
  startBar(mode)
} else {
  throw new TypeError(`Unknown mode "${mode}", expected "daemon", "waybar", or "ironbar"`)
}
