import net from 'node:net'

interface IronbarCommand {
  command: 'ping' | 'inspect' | 'reload' | 'var' | 'bar' | 'style'
  subcommand?: string
  module_name?: string
  name?: string
  value?: unknown
}

export function sendIronbarCommand (cmd: IronbarCommand) {
  const uid = process.getuid?.()
  if (uid == null) {
    return
  }

  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  const socketPath = `/run/user/${uid}/ironbar-ipc.sock`
  const socket = net.createConnection(socketPath, () => {
    socket.write(JSON.stringify(cmd))
    socket.end()
  })
}
