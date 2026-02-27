/**
 * TypeScript ambient declarations for the Electron IPC bridge
 * exposed via contextBridge in preload.ts.
 */

interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  >
}

interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

interface OpenDialogReturnValue {
  canceled: boolean
  filePaths: string[]
}

interface SaveDialogReturnValue {
  canceled: boolean
  filePath?: string
}

interface ElectronAPI {
  openFile(options: OpenDialogOptions): Promise<OpenDialogReturnValue>
  saveFile(options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, data: string): Promise<void>
  readTextFile(filePath: string): Promise<string>
  writeTextFile(filePath: string, content: string): Promise<void>
  getResourcePath(relativePath: string): Promise<string>
  openPath(folderPath: string): Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
