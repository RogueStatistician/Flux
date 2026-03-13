/**
 * Electron engine adapter — configures the shared engine with Electron-specific
 * platform dependencies (temp directory, progress event broadcaster) and re-exports.
 */
import { app, BrowserWindow } from 'electron'
import path from 'path'
import { configureEngine } from '../core/engine.js'

export { executeTransformation, cancelRun } from '../core/engine.js'

// Configure the engine with Electron-specific platform hooks
configureEngine({
  tempDir: path.join(app.getPath('temp'), 'flux-runs'),
  sendProgress: (runId, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('run:progress', { runId, ...payload })
      }
    }
  },
})
