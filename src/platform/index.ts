/**
 * Platform singleton — auto-detects Electron vs web and exports the
 * correct implementation. All renderer code imports from here.
 */
import { ElectronPlatform } from './ElectronPlatform.js'
import { WebPlatform } from './WebPlatform.js'
import type { IPlatform } from './IPlatform.js'

const isElectron = typeof window !== 'undefined' && 'electronAPI' in window
console.log(isElectron)
export const platform: IPlatform = /*isElectron
  ? new ElectronPlatform()
  :*/ new WebPlatform()
console.log(platform)
export type { IPlatform, RunProgressEvent } from './IPlatform.js'
