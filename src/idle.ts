import { MessageWriter, WaylandClient } from './wayland.js'
import { markTimelineSuspended, setTimelineEntryIdle } from './toggl.js'

// Idle detection through the ext-idle-notify-v1 wayland protocol, which sway
// (>= 1.8), jay and most wlroots-based compositors implement. Like swayidle's
// default this respects idle inhibitors, so a call or a video that holds one
// counts as activity.
//
// Note that on jay this global is only advertised to clients that have been
// granted the "idle-notifier" capability, see the README.

const SEAT_INTERFACE = 'wl_seat'
const NOTIFIER_INTERFACE = 'ext_idle_notifier_v1'

const NOTIFIER_REQUEST_GET_IDLE_NOTIFICATION = 1
const NOTIFICATION_EVENT_IDLED = 0
const NOTIFICATION_EVENT_RESUMED = 1

const IDLE_TIMEOUT_MS = 2 * 60 * 1000

// jay measures idle time on CLOCK_MONOTONIC, which stands still while the
// machine is suspended, so a suspend never shows up as idle. Node's timers run
// on the same clock, so a tick that finds the wall clock far ahead of the
// previous one means we were asleep in between.
const SUSPEND_TICK_MS = 5 * 1000
const SUSPEND_THRESHOLD_MS = 30 * 1000

let idle = false

function setIdle (value: boolean) {
  if (idle === value) return
  idle = value
  setTimelineEntryIdle(idle)
}

async function connect () {
  const client = await WaylandClient.connect()

  const globals: { seatId?: number, notifierId?: number } = {}
  const registryId = client.getRegistry((name, interfaceName) => {
    if (interfaceName === SEAT_INTERFACE && globals.seatId == null) {
      globals.seatId = client.bind(registryId, name, SEAT_INTERFACE, 1)
    } else if (interfaceName === NOTIFIER_INTERFACE && globals.notifierId == null) {
      globals.notifierId = client.bind(registryId, name, NOTIFIER_INTERFACE, 1)
    }
  })

  await client.sync()
  if (globals.notifierId == null) {
    console.error(`the compositor did not advertise ${NOTIFIER_INTERFACE}, idle detection is disabled. ` +
      'If you are running jay you need to grant this client the "idle-notifier" capability, see the README')
    return client
  }
  if (globals.seatId == null) {
    console.error(`the compositor did not advertise a ${SEAT_INTERFACE}, idle detection is disabled`)
    return client
  }

  const notificationId = client.newId()
  client.setHandler(notificationId, opcode => {
    if (opcode === NOTIFICATION_EVENT_IDLED) setIdle(true)
    else if (opcode === NOTIFICATION_EVENT_RESUMED) setIdle(false)
  })
  client.send(globals.notifierId, NOTIFIER_REQUEST_GET_IDLE_NOTIFICATION, new MessageWriter()
    .uint(notificationId)
    .uint(IDLE_TIMEOUT_MS)
    .uint(globals.seatId))

  return client
}

function connectLoop () {
  connect()
    .then(client => {
      client.onDisconnect(() => {
        setIdle(false)
        setTimeout(connectLoop, 5000)
      })
    })
    .catch((err: unknown) => {
      console.error('failed to connect to the wayland compositor for idle detection', err)
      setTimeout(connectLoop, 5000)
    })
}

export function startIdleDetection () {
  connectLoop()

  let lastTick = Date.now()
  setInterval(() => {
    const now = Date.now()
    if (now - lastTick > SUSPEND_THRESHOLD_MS) {
      markTimelineSuspended(Math.round(lastTick / 1000), Math.round(now / 1000))
    }
    lastTick = now
  }, SUSPEND_TICK_MS)
}

export function getIsIdle () {
  return idle
}
