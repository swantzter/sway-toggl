import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { setTimelineEntryIdle } from './toggl.js'

let idle = false

export async function startSwayidle () {
  const child = spawn('swayidle', ['-w',
    'timeout', '120', 'echo 1',
    'resume', 'echo 0',
    'resume', 'echo 0',
    'before-sleep', 'echo 1',
    'after-resume', 'echo 0',
  ])

  const rl = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  })

  child.on('close', () => {
    // eslint-disable-next-line no-void
    void startSwayidle()
  })

  for await (const line of rl) {
    if (line === '1') idle = true
    else if (line === '0') idle = false

    setTimelineEntryIdle(idle)
  }
}

// eslint-disable-next-line no-void
void startSwayidle()

export function getIsIdle () {
  return idle
}
