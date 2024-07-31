import { randomInt } from 'crypto'
import config from './config.js'

const BASE_URL = 'https://api.track.toggl.com'
const USER_AGENT = `node/${process.version} (svante@swantzter.se)`
const META_INTERVAL = 1000 * 60 * 10

interface TimeEntry {
  id: number
  billable: boolean

  description: string | null
  start: string
  at: string // last update time
  stop: string | null
  duration: number

  workspace_id: number
  project_id: number | null
  task_id: number | null
  user_id: number
  tag_ids: number[]
}

let cooldown = 0
let lastCooldown = 0
let currentEntry: TimeEntry | null = null

export function getIsTracking () {
  return currentEntry != null
}

export function getCurrentEntry () {
  return currentEntry
}

export async function refreshIsTracking () {
  if (cooldown > 0) {
    cooldown--
    return
  }

  try {
    let authHeader: string
    if (config.auth.apiToken) {
      authHeader = Buffer.from(`${config.auth.apiToken}:api_token`, 'utf-8').toString('base64')
    } else if (config.auth.username && config.auth.password) {
      authHeader = Buffer.from(`${config.auth.username}:${config.auth.password}`, 'utf-8').toString('base64')
    } else {
      throw new TypeError('API token or Email & Password must be specified')
    }

    const res = await fetch(new URL('/api/v9/me/time_entries/current', BASE_URL), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${authHeader}`,
        'user-agent': USER_AGENT,
      },
    })

    if (res.ok) {
      // reset the backoff
      lastCooldown = 0

      const body = await res.json()

      currentEntry = body as TimeEntry | null
    } else {
      if (res.status === 429) {
        cooldown = 1 + lastCooldown
        // implement a backoff strategy here, this will keep counting up if
        // we keep failing after waiting
        lastCooldown = cooldown
      } else {
        console.error('Failed to poll tracking status', {
          status: res.status,
          body: await res.text(),
        })
      }
    }
  } catch (err) {
    console.error('Failed to poll tracking status', err)
  }
}

interface TimelineEvent {
  id: number
  start_time: number
  end_time: number
  desktop_id: string
  filename: string
  title: string
  idle: boolean
}
const timeline: TimelineEvent[] = []
let recordingEntry: Omit<TimelineEvent, 'end_time'> | undefined

export function startTimelineEntry (data: Pick<TimelineEvent, 'filename' | 'title' | 'idle'>) {
  if (recordingEntry != null) stopTimelineEntry()

  // so, if a thing we just looked at got discarded for not being looked at long
  // enough, and we're back at at looking on it, revive it as the recordingEntry
  const lastEntry = timeline.at(-1)
  if (lastEntry != null && lastEntry.filename === data.filename && lastEntry.title === data.title) {
    recordingEntry = timeline.pop()
    return
  }

  // if it's not the same, we're looking at a new thing
  recordingEntry = {
    ...data,
    id: randomInt(281474976710655),
    start_time: Math.round(Date.now() / 1000),
    desktop_id: config.options.desktopId,
  }
}

export function setTimelineEntryIdle (idle: boolean) {
  if (recordingEntry == null) return

  startTimelineEntry({
    filename: recordingEntry.filename,
    title: recordingEntry.title,
    idle,
  })
}

// so I don't want to record flaky changes, but if the title hasn't changed for
// more than 10 seconds it's a new activity
let nameTimeoutId: NodeJS.Timeout | undefined
export function setTimelineEntryTitle (title: string) {
  if (nameTimeoutId != null) {
    clearTimeout(nameTimeoutId)
    nameTimeoutId = undefined
  }

  if (recordingEntry == null) return
  const id = recordingEntry.id

  nameTimeoutId = setTimeout(() => {
    if (recordingEntry != null && recordingEntry.id === id) {
      startTimelineEntry({
        ...recordingEntry,
        title,
      })
    }
  }, 10_000)
}

export function stopTimelineEntry () {
  if (recordingEntry == null) return
  const endTime = Math.round(Date.now() / 1000)

  // we only record things looked at longer than 10 seconds
  if (endTime - recordingEntry.start_time < 10) {
    recordingEntry = undefined
    return
  }

  timeline.push({
    ...recordingEntry,
    end_time: endTime,
  })
  recordingEntry = undefined
}

export async function sendTimelineData () {
  if (cooldown > 0) {
    cooldown--
    return
  }

  if (timeline.length < 2) return

  const items = timeline.slice(0, timeline.length - 1)

  try {
    let authHeader: string
    if (config.auth.apiToken) {
      authHeader = Buffer.from(`${config.auth.apiToken}:api_token`, 'utf-8').toString('base64')
    } else if (config.auth.username && config.auth.password) {
      authHeader = Buffer.from(`${config.auth.username}:${config.auth.password}`, 'utf-8').toString('base64')
    } else {
      throw new TypeError('API token or Email & Password must be specified')
    }

    const res = await fetch(new URL('/api/v9/timeline', 'https://track.toggl.com'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Basic ${authHeader}`,
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify(items),
    })

    if (res.ok) {
      // reset the backoff
      lastCooldown = 0

      const lastIdx = timeline.findIndex(item => item.id === items.at(-1)?.id)
      if (lastIdx !== -1) {
        timeline.splice(0, lastIdx + 1)
      }
    } else {
      if (res.status === 429) {
        cooldown = 1 + lastCooldown
        // implement a backoff strategy here, this will keep counting up if
        // we keep failing after waiting
        lastCooldown = cooldown
      } else {
        console.error('Failed to submit timeline entries', {
          status: res.status,
          body: await res.text(),
        })
      }
    }
  } catch (err) {
    console.error('Failed to submit timeline entries', err)
  }
}

interface TogglProject {
  id: number
  active: boolean
  billable: boolean | null
  color: string
  currency: string | null
  name: string
}
interface TogglTag {
  id: number
  name: string
}
interface TogglTask {
  id: number
  name: string
  projcet_id: number
}
interface TogglMeta {
  id: number
  default_workspace_id: number
  fullname: string
  projects: TogglProject[]
  tags: TogglTag[]
  tasks: TogglTask[]
}
let togglMeta: TogglMeta | null = null
let togglMetaFetched = -Infinity

export function getProjectName (projectId: number) {
  return togglMeta?.projects.find(project => project.id === projectId)?.name ?? projectId.toString()
}
export function getTaskName (taskId: number) {
  return togglMeta?.tasks.find(tasks => tasks.id === taskId)?.name ?? taskId.toString()
}

export async function refreshMetadata () {
  if (Date.now() - togglMetaFetched < META_INTERVAL) return

  if (cooldown > 0) {
    cooldown--
    return
  }

  try {
    let authHeader: string
    if (config.auth.apiToken) {
      authHeader = Buffer.from(`${config.auth.apiToken}:api_token`, 'utf-8').toString('base64')
    } else if (config.auth.username && config.auth.password) {
      authHeader = Buffer.from(`${config.auth.username}:${config.auth.password}`, 'utf-8').toString('base64')
    } else {
      throw new TypeError('API token or Email & Password must be specified')
    }

    const res = await fetch(new URL('/api/v9/me?with_related_data=true', BASE_URL), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${authHeader}`,
        'user-agent': USER_AGENT,
      },
    })

    if (res.ok) {
      // reset the backoff
      lastCooldown = 0

      const body = await res.json()

      togglMeta = body as TogglMeta | null
      togglMetaFetched = Date.now()
    } else {
      if (res.status === 429) {
        cooldown = 1 + lastCooldown
        // implement a backoff strategy here, this will keep counting up if
        // we keep failing after waiting
        lastCooldown = cooldown
      } else {
        console.error('Failed to update toggl metadata', {
          status: res.status,
          body: await res.text(),
        })
      }
    }
  } catch (err) {
    console.error('Failed to update toggl metadata', err)
  }
}
