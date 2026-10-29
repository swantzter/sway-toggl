import net from 'node:net'
import path from 'node:path'
import { unlink } from 'node:fs/promises'

// The daemon publishes what the bar needs to show on a unix socket, one JSON
// object per line, so bars that start one copy of the module per output (like
// waybar) don't each run their own tracking reminders and timeline reporting.

export interface BarEntry {
  description: string | null
  // "Project" or "Project: Task"
  project: string | null
  start: string
}

export interface BarState {
  entry: BarEntry | null
}

export function getSocketPath () {
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  if (runtimeDir == null) {
    throw new Error('XDG_RUNTIME_DIR is not set, cannot find the sway-toggl socket')
  }
  return path.join(runtimeDir, 'sway-toggl.sock')
}

const clients = new Set<net.Socket>()
let lastMessage: string | undefined

function serialize (state: BarState) {
  return JSON.stringify(state) + '\n'
}

export function publishState (state: BarState) {
  const message = serialize(state)
  if (message === lastMessage) return
  lastMessage = message
  for (const client of clients) client.write(message)
}

async function listenOn (server: net.Server, socketPath: string) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function isListening (socketPath: string) {
  return await new Promise<boolean>(resolve => {
    const socket = net.createConnection(socketPath)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => { resolve(false) })
  })
}

export async function startServer (getState: () => BarState) {
  const server = net.createServer(socket => {
    clients.add(socket)
    socket.on('close', () => { clients.delete(socket) })
    socket.on('error', () => {
      // the bar went away, close follows
    })
    socket.write(serialize(getState()))
  })

  const socketPath = getSocketPath()
  try {
    await listenOn(server, socketPath)
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'EADDRINUSE')) throw err
    if (await isListening(socketPath)) {
      throw new Error(`another sway-toggl daemon is already listening on ${socketPath}`)
    }
    // left behind by a daemon that didn't get to clean up after itself
    await unlink(socketPath)
    await listenOn(server, socketPath)
  }
}
