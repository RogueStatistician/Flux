import { ipcMain, dialog, shell } from 'electron'

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:openFile', async (_event, options: Electron.OpenDialogOptions) => {
    return dialog.showOpenDialog(options)
  })

  ipcMain.handle('dialog:saveFile', async (_event, options: Electron.SaveDialogOptions) => {
    return dialog.showSaveDialog(options)
  })

  ipcMain.handle('shell:openPath', async (_event, folderPath: string) => {
    await shell.openPath(folderPath)
  })
}
