import path from 'node:path'
import notifier from 'node-notifier'
import config from './config.js'
import { getIsIdle, startIdleDetection } from './idle.js'
import { publishState, startServer, type BarState } from './ipc.js'
import { getCurrentEntry, getIsTracking, getProjectName, getTaskName, refreshIsTracking, refreshMetadata, sendTimelineData } from './toggl.js'

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

function getBarState (): BarState {
  const curr = getCurrentEntry()
  if (curr == null) return { entry: null }

  let project: string | null = null
  if (curr.project_id && curr.task_id) {
    project = `${getProjectName(curr.project_id)}: ${getTaskName(curr.task_id)}`
  } else if (curr.project_id) {
    project = getProjectName(curr.project_id)
  }

  return {
    entry: {
      description: curr.description,
      project,
      start: curr.start,
    },
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

  publishState(getBarState())

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

export async function startDaemon (backendArg: string) {
  const backend = backendArg === 'auto'
    ? (process.env.SWAYSOCK != null ? 'sway' : 'wlr')
    : backendArg
  if (backend !== 'sway' && backend !== 'wlr') {
    throw new TypeError(`Unknown backend "${backend}", expected "auto", "sway", or "wlr"`)
  }

  // before anything else, so a second daemon bails out without reporting
  // anything
  await startServer(getBarState)

  startIdleDetection()
  if (backend === 'sway') {
    await import('./swayipc.js')
  } else {
    await import('./wlrtoplevel.js')
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
}
