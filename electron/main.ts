import { app, BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerDialogHandlers } from './ipc/dialog.js'
import { registerProjectHandlers } from './ipc/project.js'
import { registerObjectHandlers } from './ipc/objects.js'
import { registerPicklistHandlers } from './ipc/picklists.js'
import { registerPlMappingHandlers } from './ipc/plmappings.js'
import { registerTransformationHandlers } from './ipc/transformations.js'
import { registerRunHandlers } from './ipc/runs.js'
import { registerDevtoolsHandlers } from './ipc/devtools.js'

// ESM does not provide __dirname — reconstruct it from import.meta.url
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'Flux',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  // Register all IPC handlers before creating the window
  registerDialogHandlers()
  registerProjectHandlers()
  registerObjectHandlers()
  registerPicklistHandlers()
  registerPlMappingHandlers()
  registerTransformationHandlers()
  registerRunHandlers()
  registerDevtoolsHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
