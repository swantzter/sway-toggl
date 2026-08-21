import { MessageReader, WaylandClient } from './wayland.js'
import { setTimelineEntryTitle, startTimelineEntry, stopTimelineEntry } from './toggl.js'
import { getIsIdle } from './swayidle.js'

// Activity reporting for compositors without the sway IPC (jay, and any other
// compositor implementing wlr-foreign-toplevel-management). The compositor
// tells us about every toplevel and which one is activated (focused), which
// maps onto the same timeline calls as the sway backend.
//
// Note that on jay this global is only advertised to clients that have been
// granted the "foreign-toplevel-manager" capability, see the README.

const MANAGER_INTERFACE = 'zwlr_foreign_toplevel_manager_v1'

const MANAGER_EVENT_TOPLEVEL = 0
const HANDLE_EVENT_TITLE = 0
const HANDLE_EVENT_APP_ID = 1
const HANDLE_EVENT_STATE = 4
const HANDLE_EVENT_DONE = 5
const HANDLE_EVENT_CLOSED = 6
const HANDLE_REQUEST_DESTROY = 7
const STATE_ACTIVATED = 2

interface Toplevel {
  id: number
  title: string
  appId: string
  activated: boolean
  pending: Partial<Pick<Toplevel, 'title' | 'appId' | 'activated'>>
}

let focusedId: number | undefined

function commit (toplevel: Toplevel) {
  const wasFocused = focusedId === toplevel.id
  const titleChanged = toplevel.pending.title != null && toplevel.pending.title !== toplevel.title
  Object.assign(toplevel, toplevel.pending)
  toplevel.pending = {}

  if (toplevel.activated && !wasFocused) {
    focusedId = toplevel.id
    startTimelineEntry({ filename: toplevel.appId, title: toplevel.title, idle: getIsIdle() })
  } else if (wasFocused && !toplevel.activated) {
    // nothing has focus anymore, e.g. an empty workspace was focused
    focusedId = undefined
    stopTimelineEntry()
  } else if (wasFocused && titleChanged) {
    setTimelineEntryTitle(toplevel.title)
  }
}

function handleToplevelEvent (client: WaylandClient, toplevel: Toplevel, opcode: number, reader: MessageReader) {
  switch (opcode) {
    case HANDLE_EVENT_TITLE:
      toplevel.pending.title = reader.string()
      break
    case HANDLE_EVENT_APP_ID:
      toplevel.pending.appId = reader.string()
      break
    case HANDLE_EVENT_STATE: {
      const states = reader.array()
      toplevel.pending.activated = false
      for (let off = 0; off + 4 <= states.byteLength; off += 4) {
        if (states.readUInt32LE(off) === STATE_ACTIVATED) toplevel.pending.activated = true
      }
      break
    }
    case HANDLE_EVENT_DONE:
      commit(toplevel)
      break
    case HANDLE_EVENT_CLOSED:
      client.send(toplevel.id, HANDLE_REQUEST_DESTROY)
      client.removeHandler(toplevel.id)
      if (focusedId === toplevel.id) {
        focusedId = undefined
        stopTimelineEntry()
      }
      break
  }
}

async function connect () {
  const client = await WaylandClient.connect()

  const state = { managerBound: false }
  const registryId = client.getRegistry((name, interfaceName) => {
    if (interfaceName !== MANAGER_INTERFACE || state.managerBound) return
    state.managerBound = true

    const managerId = client.bind(registryId, name, MANAGER_INTERFACE, 1)
    client.setHandler(managerId, (opcode, reader) => {
      if (opcode === MANAGER_EVENT_TOPLEVEL) {
        const toplevel: Toplevel = { id: reader.uint(), title: '', appId: '', activated: false, pending: {} }
        client.setHandler(toplevel.id, (opcode, reader) => { handleToplevelEvent(client, toplevel, opcode, reader) })
      }
    })
  })

  await client.sync()
  if (!state.managerBound) {
    console.error(`the compositor did not advertise ${MANAGER_INTERFACE}. ` +
      'If you are running jay you need to grant this client the "foreign-toplevel-manager" capability, see the README')
  }

  return client
}

function start () {
  connect()
    .then(client => {
      client.onDisconnect(() => {
        focusedId = undefined
        stopTimelineEntry()
        setTimeout(start, 5000)
      })
    })
    .catch((err: unknown) => {
      console.error('failed to connect to the wayland compositor', err)
      setTimeout(start, 5000)
    })
}

start()
