import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const crowsnestApi = {
  call: (name, ...args) => ipcRenderer.invoke('crowsnest:call', name, args)
} satisfies PreloadApi['crowsnest']
