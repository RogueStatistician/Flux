/**
 * Preload script — the narrow IPC bridge between the Renderer (React) and the
 * Main process (Node.js / Electron). Exposes only the minimal surface area
 * needed for the application to function.
 *
 * Security:
 *  - contextIsolation: true  (enforced in main.ts)
 *  - nodeIntegration: false  (enforced in main.ts)
 *  - All Node.js / Electron APIs are accessed via explicit, typed wrappers only.
 */
import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  /** Open a native file picker. */
  openFile: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('dialog:openFile', options),

  /** Open a native save dialog. */
  saveFile: (options: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke('dialog:saveFile', options),

  /** Read binary file as base64 (for SheetJS). */
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', filePath),

  /** Write binary data (base64) to disk. */
  writeFile: (filePath: string, data: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', filePath, data),

  /** Read a UTF-8 text file (JSON profiles / templates). */
  readTextFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readTextFile', filePath),

  /** Write a UTF-8 text file (save profile). */
  writeTextFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeTextFile', filePath, content),

  /** Resolve resource path (bundled templates/profiles). */
  getResourcePath: (relativePath: string): Promise<string> =>
    ipcRenderer.invoke('app:getResourcePath', relativePath),

  /** Open a folder in the OS file explorer. */
  openPath: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('shell:openPath', folderPath),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// TypeScript: expose the type globally in the renderer.
export type ElectronAPI = typeof electronAPI
