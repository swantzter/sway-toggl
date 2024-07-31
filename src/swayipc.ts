import _SwayIPC from 'node-sway'
import { setTimelineEntryTitle, startTimelineEntry, stopTimelineEntry } from './toggl.js'
import { getIsIdle } from './swayidle.js'

const SwayIPC = _SwayIPC.default

const ipc = new SwayIPC()
ipc.on('data', ({ data, type }) => {
  switch (type) {
    case SwayIPC.events.WINDOW:
      handleWindowEvent(data as WindowEvent)
      break
    case SwayIPC.events.WORKSPACE:
      handleWorkspaceEvent(data as WorkspaceEvent)
      break
  }
})
ipc.subscribe([SwayIPC.events.WINDOW, SwayIPC.events.WORKSPACE])

let currentFocusCon: number | undefined

interface WindowEvent {
  change: 'new' | 'close' | 'focus' | 'title' | 'fullscreen_mode' | 'move' |
    'floating' | 'urgent' | 'mark'
  container: {
    // id: number,
    // type: string,
    // orientation: 'none',
    // percent: 1,
    // urgent: false,
    // marks: [],
    // focused: true,
    // layout: 'none',
    // border: 'none',
    // current_border_width: 2,
    // rect: { x: 0, y: 30, width: 1920, height: 1140 },
    // deco_rect: { x: 0, y: 0, width: 0, height: 0 },
    // window_rect: { x: 0, y: 0, width: 1920, height: 1140 },
    // geometry: { x: 0, y: 0, width: 1920, height: 1140 },
    // name: 'swayipc.ts - Untitled (Workspace) - Visual Studio Code - Insiders',
    // window: null,
    // nodes: [],
    // floating_nodes: [],
    // focus: [],
    // fullscreen_mode: 0,
    // sticky: false,
    // pid: 1763746,
    // app_id: 'code-insiders-url-handler',
    // visible: true,
    // max_render_time: 0,
    // shell: 'xdg_shell',
    // inhibit_idle: false,
    // idle_inhibitors: { user: 'fullscreen', application: 'none' }
    id: number
    type: 'con'
    urgent: boolean
    focused: boolean
    name: string
    app_id: string
  }
}
function handleWindowEvent (data: WindowEvent) {
  switch (data.change) {
    case 'focus':
      currentFocusCon = data.container.id
      startTimelineEntry({ filename: data.container.app_id, title: data.container.name, idle: getIsIdle() })
      break
    case 'close': {
      if (currentFocusCon === data.container.id) {
        currentFocusCon = undefined
        stopTimelineEntry()
      }
      break
    }
    case 'title': {
      if (currentFocusCon === data.container.id) {
        setTimelineEntryTitle(data.container.name)
      }
      break
    }
  }
}

interface WorkspaceInfo {
  // "id": 10,
  // "name": "2",
  // "rect": {
  //   "x": 0,
  //   "y": 0,
  //   "width": 0,
  //   "height": 0
  // },
  // "focused": false,
  // "focus": [
  // ],
  // "border": "none",
  // "current_border_width": 0,
  // "layout": "splith",
  // "percent": null,
  // "window_rect": {
  //   "x": 0,
  //   "y": 0,
  //   "width": 0,
  //   "height": 0
  // },
  // "deco_rect": {
  //   "x": 0,
  //   "y": 0,
  //   "width": 0,
  //   "height": 0
  // },
  // "geometry": {
  //   "x": 0,
  //   "y": 0,
  //   "width": 0,
  //   "height": 0
  // },
  // "window": null,
  // "urgent": false,
  // "floating_nodes": [
  // ],
  // "num": 2,
  // "output": "eDP-1",
  // "type": "workspace",
  // "representation": null,
  // "nodes": [
  // ]
  id: number
  type: 'workspace'
  name: string
  num: number
  output: string
  focused: boolean
  nodes: unknown[]
}
interface WorkspaceEvent {
  change: 'init' | 'empty' | 'focus' | 'move' | 'rename' | 'urgent' | 'reload'
  current: WorkspaceInfo
  old: WorkspaceInfo
}
function handleWorkspaceEvent (data: WorkspaceEvent) {
  if (data.change === 'focus' && data.current.nodes.length === 0) {
    stopTimelineEntry()
  }
}
