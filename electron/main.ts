import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'SF2WD — SuccessFactors to Workday Migration Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC Handlers ──────────────────────────────────────────────────────────────

/**
 * Open a native file picker and return the chosen file path(s).
 */
ipcMain.handle('dialog:openFile', async (_event, options: Electron.OpenDialogOptions) => {
  const result = await dialog.showOpenDialog(options)
  return result
})

/**
 * Open a native save dialog and return the chosen path.
 */
ipcMain.handle('dialog:saveFile', async (_event, options: Electron.SaveDialogOptions) => {
  const result = await dialog.showSaveDialog(options)
  return result
})

/**
 * Read a file from disk and return its contents as a Buffer (base64 encoded).
 */
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const buffer = fs.readFileSync(filePath)
  return buffer.toString('base64')
})

/**
 * Write base64-encoded data to a file on disk.
 */
ipcMain.handle('fs:writeFile', async (_event, filePath: string, data: string) => {
  const buffer = Buffer.from(data, 'base64')
  fs.writeFileSync(filePath, buffer)
})

/**
 * Read a UTF-8 text file (for JSON profiles and templates).
 */
ipcMain.handle('fs:readTextFile', async (_event, filePath: string) => {
  return fs.readFileSync(filePath, 'utf-8')
})

/**
 * Write a UTF-8 text file (for saving profiles).
 */
ipcMain.handle('fs:writeTextFile', async (_event, filePath: string, content: string) => {
  fs.writeFileSync(filePath, content, 'utf-8')
})

/**
 * Resolve the path to bundled templates/profiles (works in dev and packaged).
 */
ipcMain.handle('app:getResourcePath', async (_event, relativePath: string) => {
  if (isDev) {
    return path.join(process.cwd(), relativePath)
  }
  return path.join(process.resourcesPath, relativePath)
})

/**
 * Open a folder in the OS file explorer.
 */
ipcMain.handle('shell:openPath', async (_event, folderPath: string) => {
  shell.openPath(folderPath)
})
