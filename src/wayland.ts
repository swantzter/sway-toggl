import net from 'node:net'
import path from 'node:path'

// A minimal wayland wire protocol client, just enough to bind globals and
// receive events. None of the protocols we use pass file descriptors, which
// is good because node's net.Socket cannot receive ancillary data.

const WL_DISPLAY = 1
const WL_DISPLAY_REQUEST_SYNC = 0
const WL_DISPLAY_REQUEST_GET_REGISTRY = 1
const WL_DISPLAY_EVENT_ERROR = 0
const WL_REGISTRY_REQUEST_BIND = 0
const WL_REGISTRY_EVENT_GLOBAL = 0

export class MessageReader {
  private off = 0
  constructor (private readonly buf: Buffer) {}

  uint () {
    const value = this.buf.readUInt32LE(this.off)
    this.off += 4
    return value
  }

  int () {
    const value = this.buf.readInt32LE(this.off)
    this.off += 4
    return value
  }

  string () {
    // length includes the NUL terminator, contents are padded to 32 bits
    const len = this.uint()
    if (len === 0) return ''
    const value = this.buf.toString('utf-8', this.off, this.off + len - 1)
    this.off += (len + 3) & ~3
    return value
  }

  array () {
    const len = this.uint()
    const value = this.buf.subarray(this.off, this.off + len)
    this.off += (len + 3) & ~3
    return value
  }
}

export class MessageWriter {
  private readonly parts: Buffer[] = []

  uint (value: number) {
    const buf = Buffer.alloc(4)
    buf.writeUInt32LE(value >>> 0)
    this.parts.push(buf)
    return this
  }

  string (value: string) {
    const data = Buffer.from(value, 'utf-8')
    const len = data.byteLength + 1
    const buf = Buffer.alloc(4 + ((len + 3) & ~3))
    buf.writeUInt32LE(len)
    data.copy(buf, 4)
    this.parts.push(buf)
    return this
  }

  build () {
    return Buffer.concat(this.parts)
  }
}

export type EventHandler = (opcode: number, reader: MessageReader) => void

function getSocketPath () {
  const display = process.env.WAYLAND_DISPLAY ?? 'wayland-0'
  if (path.isAbsolute(display)) return display
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  if (runtimeDir == null) {
    throw new Error('XDG_RUNTIME_DIR is not set, cannot find the wayland socket')
  }
  return path.join(runtimeDir, display)
}

export class WaylandClient {
  private recv: Buffer = Buffer.alloc(0)
  private nextId = 2
  private readonly handlers = new Map<number, EventHandler>()
  private readonly closeHandlers: (() => void)[] = []

  private constructor (private readonly socket: net.Socket) {
    socket.on('data', chunk => { this.onData(chunk) })
    socket.on('error', (err: unknown) => { console.error('wayland socket error', err) })
    socket.on('close', () => {
      for (const handler of this.closeHandlers) handler()
    })

    this.setHandler(WL_DISPLAY, (opcode, reader) => {
      if (opcode === WL_DISPLAY_EVENT_ERROR) {
        const objectId = reader.uint()
        const code = reader.uint()
        const message = reader.string()
        console.error('wayland protocol error', { objectId, code, message })
      }
      // the only other event is delete_id, which we can ignore since we
      // never reuse object ids
    })
  }

  static async connect () {
    const socketPath = getSocketPath()
    return await new Promise<WaylandClient>((resolve, reject) => {
      const socket = net.createConnection(socketPath)
      socket.once('connect', () => { resolve(new WaylandClient(socket)) })
      socket.once('error', reject)
    })
  }

  onDisconnect (handler: () => void) {
    this.closeHandlers.push(handler)
  }

  setHandler (objectId: number, handler: EventHandler) {
    this.handlers.set(objectId, handler)
  }

  removeHandler (objectId: number) {
    this.handlers.delete(objectId)
  }

  send (objectId: number, opcode: number, writer?: MessageWriter) {
    const body = writer?.build() ?? Buffer.alloc(0)
    const header = Buffer.alloc(8)
    header.writeUInt32LE(objectId, 0)
    header.writeUInt32LE((((8 + body.byteLength) << 16) | opcode) >>> 0, 4)
    this.socket.write(Buffer.concat([header, body]))
  }

  getRegistry (onGlobal: (name: number, interfaceName: string, version: number) => void) {
    const registryId = this.nextId++
    this.setHandler(registryId, (opcode, reader) => {
      if (opcode === WL_REGISTRY_EVENT_GLOBAL) {
        const name = reader.uint()
        const interfaceName = reader.string()
        const version = reader.uint()
        onGlobal(name, interfaceName, version)
      }
    })
    this.send(WL_DISPLAY, WL_DISPLAY_REQUEST_GET_REGISTRY, new MessageWriter().uint(registryId))
    return registryId
  }

  bind (registryId: number, name: number, interfaceName: string, version: number) {
    const objectId = this.nextId++
    this.send(registryId, WL_REGISTRY_REQUEST_BIND, new MessageWriter()
      .uint(name)
      .string(interfaceName)
      .uint(version)
      .uint(objectId))
    return objectId
  }

  async sync () {
    await new Promise<void>(resolve => {
      const callbackId = this.nextId++
      this.setHandler(callbackId, () => {
        this.removeHandler(callbackId)
        resolve()
      })
      this.send(WL_DISPLAY, WL_DISPLAY_REQUEST_SYNC, new MessageWriter().uint(callbackId))
    })
  }

  private onData (chunk: Buffer) {
    this.recv = this.recv.byteLength === 0 ? chunk : Buffer.concat([this.recv, chunk])
    while (this.recv.byteLength >= 8) {
      const size = this.recv.readUInt32LE(4) >>> 16
      if (size < 8 || this.recv.byteLength < size) break
      const objectId = this.recv.readUInt32LE(0)
      const opcode = this.recv.readUInt32LE(4) & 0xffff
      const body = this.recv.subarray(8, size)
      this.recv = this.recv.subarray(size)
      this.handlers.get(objectId)?.(opcode, new MessageReader(body))
    }
  }
}
