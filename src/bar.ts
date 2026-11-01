import net from 'node:net'
import { createInterface } from 'node:readline'
import { intervalToDuration, parseISO } from 'date-fns'
import { getSocketPath, type BarState } from './ipc.js'
import { sendIronbarCommand } from './ironbaripc.js'

// The bar side only renders what the daemon publishes, so it is fine for a bar
// to run one copy of it per output.

// undefined while we're not connected to the daemon
let state: BarState | undefined

function connect () {
  const socket = net.createConnection(getSocketPath())
  const rl = createInterface({
    input: socket,
    crlfDelay: Infinity,
  })

  rl.on('line', line => {
    try {
      state = JSON.parse(line) as BarState
    } catch (err) {
      console.error('failed to parse state from the sway-toggl daemon', err)
    }
  })
  // readline re-emits errors from the socket, like the daemon not running
  rl.on('error', () => {
    // close follows and retries
  })
  socket.on('close', () => {
    state = undefined
    setTimeout(connect, 2000)
  })
}

function printWaybar () {
  const entry = state?.entry
  const tooltip = []
  if (state == null) {
    tooltip.push('sway-toggl daemon is not running')
  } else if (entry != null) {
    tooltip.push(entry.description ?? '(no description)')

    if (entry.project != null) {
      tooltip.push(entry.project)
    }

    const start = parseISO(entry.start)
    const now = Date.now()
    const duration = intervalToDuration({ start, end: now })
    tooltip.push(`${duration.hours?.toString() ?? '0'}:${duration.minutes?.toString().padStart(2, '0') ?? '00'}:${duration.seconds?.toString().padStart(2, '0') ?? '00'}`)
  } else {
    tooltip.push('Not tracking')
  }
  console.log(JSON.stringify({
    text: '',
    alt: '',
    tooltip: tooltip.join('\r'),
    percentage: entry != null ? 100 : 0,
    class: entry != null ? 'tracking' : 'disabled',
  }))
}

let ironbarDisabled = false
function printIronbar () {
  if (state?.entry != null) {
    if (ironbarDisabled) {
      sendIronbarCommand({ command: 'style', subcommand: 'remove_class', module_name: 'toggl', name: 'disabled' })
      ironbarDisabled = false
    }
    console.log('󰐥')
  } else {
    if (!ironbarDisabled) {
      sendIronbarCommand({ command: 'style', subcommand: 'add_class', module_name: 'toggl', name: 'disabled' })
      ironbarDisabled = true
    }
    console.log('󰐥')
  }
}

export function startBar (mode: 'waybar' | 'ironbar') {
  connect()

  setInterval(() => {
    try {
      if (mode === 'ironbar') {
        printIronbar()
      } else {
        printWaybar()
      }
    } catch (err) {
      console.error(`failed to print ${mode} data`, err)
    }
  }, 500)
}
