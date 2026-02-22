import path from 'node:path'
import config from './config.js'
import { getIsIdle } from './swayidle.js'
import './swayipc.js'
import notifier from 'node-notifier'
import { getCurrentEntry, getIsTracking, getProjectName, getTaskName, refreshIsTracking, refreshMetadata, sendTimelineData } from './toggl.js'
import { intervalToDuration, parseISO } from 'date-fns'
import { parseArgs } from 'node:util'
import { sendIronbarCommand } from './ironbaripc.js'

const args = parseArgs({
  options: {
    mode: {
      type: 'string',
      default: 'waybar',
    },
  },
})

let lastNotified = -Infinity
function trackingReminder () {
  if (!getIsIdle() && !getIsTracking()) {
    if ((Date.now() - lastNotified) > config.options.idleNotifyInterval) {
      notifier.notify({
        title: 'Toggl Track',
        message: 'Remember to track your time!',
        icon: path.join(import.meta.dirname, 'icon-pink.svg'),
        // open: 'https://track.toggl.com',
        // @ts-expect-error this is fine
        'app-name': 'Toggl Track',
      })
      lastNotified = Date.now()
    }
  }
  if (getIsTracking()) {
    lastNotified = Date.now()
  }
}

function printWaybar () {
  const curr = getCurrentEntry()
  const tooltip = []
  if (curr) {
    tooltip.push(curr.description ?? '(no description)')

    if (curr.project_id && curr.task_id) {
      const projectName = getProjectName(curr.project_id)
      const taskName = getTaskName(curr.task_id)
      tooltip.push(`${projectName}: ${taskName}`)
    } else if (curr.project_id) {
      const projectName = getProjectName(curr.project_id)
      tooltip.push(projectName)
    }

    const start = parseISO(curr.start)
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
    percentage: getIsTracking() ? 100 : 0,
    class: getIsTracking() ? 'tracking' : 'disabled',
  }))
}

let ironbarDisabled = false
function printIronbar () {
  const curr = getCurrentEntry()
  if (curr) {
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

async function run () {
  try {
    await refreshMetadata()
  } catch (err) {
    console.error('failed to refresh toggl metadata', err)
  }

  try {
    await refreshIsTracking()
  } catch (err) {
    console.error('failed to refresh tracking status', err)
  }

  try {
    trackingReminder()
  } catch (err) {
    console.error('failed to send tracking reminder', err)
  }

  try {
    await sendTimelineData()
  } catch (err) {
    console.error('failed to send timeline data', err)
  }
}

run()
  .catch((err: unknown) => {
    console.error(err)
  })

setInterval(() => {
  run()
    .catch((err: unknown) => {
      console.error(err)
    })
}, 2.5 * 60 * 1000)

setInterval(() => {
  try {
    if (args.values.mode === 'ironbar') {
      printIronbar()
    } else {
      printWaybar()
    }
  } catch (err) {
    console.error('failed to print waybar data', err)
  }
}, 500)
