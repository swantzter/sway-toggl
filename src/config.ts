import * as INI from 'ini'
import * as path from 'node:path'
import { access, constants, readFile, writeFile } from 'node:fs/promises'
import { xdgConfig } from 'xdg-basedir'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'

// This is meant to mimic the behaviour of https://toggl.uhlir.dev/

// TOGGL_WORKSPACE - Defines workspace to be used for the command, can be ID or Name of the Workspace.
// TOGGL_TASK - Defines task to be used, can be ID or Name of the Task.
// TOGGL_PROJECT - Defines project to be used, can be ID or Name of the Project.

interface AuthConf {
  apiToken?: string,
  username?: string,
  password?: string
}

interface OptionsConf {
  idleNotifyInterval: number
  desktopId: string
}

interface FileConf {
  version?: { version?: string }
  auth?: {
    api_token?: string,
    username?: string,
    password?: string
  }
  options?: {
    idle_notify_interval_seconds: string | number
    desktop_id?: string
  }
}

let fileConf: FileConf | undefined

const envConf = {
  auth: {
    apiToken: process.env.TOGGL_API_TOKEN,
    username: process.env.TOGGL_USERNAME,
    password: process.env.TOGGL_PASSWORD,
  },
  // options: {
  //   defaultWid: process.env.TOGGL_WORKSPACE,
  // },
}

function isFileConf (x: unknown): x is FileConf {
  return x != null && typeof x === 'object' &&
    'auth' in x && typeof x.auth === 'object' && x.auth != null &&
    ('api_token' in x.auth || 'username' in x.auth) &&
    (!('options' in x) || ('options' in x && typeof x.options === 'object'))
}

async function readFileConf () {
  let configPath = path.normalize(path.join(homedir(), '.togglrc'))

  try {
    const newPath = path.normalize(path.join(xdgConfig ?? path.join(homedir(), '.config'), '.togglrc'))
    await access(newPath, constants.R_OK)
    configPath = newPath
  } catch {}

  if (process.env.TOGGL_CONFIG) {
    try {
      const newPath = path.normalize(process.env.TOGGL_CONFIG)
      await access(newPath, constants.R_OK)
      configPath = newPath
    } catch {}
  }

  const toml = await readFile(configPath, 'utf-8')

  const parsedToml: unknown = INI.parse(toml)

  if (!isFileConf(parsedToml)) throw new TypeError('Bad config file')

  fileConf = parsedToml

  if (fileConf.options?.desktop_id == null) {
    fileConf.options ??= { idle_notify_interval_seconds: 5 * 60 }
    fileConf.options.desktop_id = randomUUID()

    await writeFile(configPath, INI.stringify(fileConf), { encoding: 'utf-8' })
  }
}

await readFileConf()

const authProxy = new Proxy<AuthConf>({}, {
  get (target, prop) {
    switch (prop) {
      case 'apiToken':
        return envConf.auth.apiToken ?? fileConf?.auth?.api_token
      case 'username':
        return envConf.auth.username ?? fileConf?.auth?.username
      case 'password':
        return envConf.auth.password ?? fileConf?.auth?.password
    }
  },
})

const optionsProxy: OptionsConf = new Proxy({
  idleNotifyInterval: 1000 * 60 * 5,
  desktopId: randomUUID(),
}, {
  get (target, prop) {
    switch (prop) {
      case 'idleNotifyInterval': {
        if (
          fileConf?.options?.idle_notify_interval_seconds != null &&
          !Number.isSafeInteger(parseInt(fileConf.options.idle_notify_interval_seconds as string))
        ) {
          return parseInt(fileConf.options.idle_notify_interval_seconds as string) * 1000
        } else return target[prop]
      }
      case 'desktopId':
        return fileConf?.options?.desktop_id
    }
  },
})

const config = {
  auth: authProxy,
  options: optionsProxy,
}

export default config
