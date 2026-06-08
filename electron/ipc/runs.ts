/**
 * Run & export IPC handlers — thin Electron wrapper around core/engine.ts and core/services/runs.ts.
 */
import { ipcMain } from 'electron'
import { executeTransformation, cancelRun } from '../engine.js'
import { getRun, listRuns, getRunIssues, previewOutput, copyOutputFile, exportMappingAudit } from '../../core/services/runs.js'

export function registerRunHandlers(): void {
  ipcMain.handle('run:start', async (_e, transformationId: string) => executeTransformation(transformationId))
  ipcMain.handle('run:cancel', async (_e, runId: string) => cancelRun(runId))
  ipcMain.handle('run:get', async (_e, runId: string) => getRun(runId))
  ipcMain.handle('run:list', async (_e, transformationId?: string) => listRuns(transformationId))
  ipcMain.handle('run:getIssues', async (_e, runId: string, severity?: string) => getRunIssues(runId, severity))
  ipcMain.handle('run:previewOutput', async (_e, runId: string, targetObjectId: string, limit = 100) => previewOutput(runId, targetObjectId, limit))
  ipcMain.handle('export:saveOutput', async (_e, runId: string, targetObjectId: string, destPath: string) => copyOutputFile(runId, targetObjectId, destPath))
  ipcMain.handle('export:mappingAudit', async (_e, transformationId: string, destPath: string) => exportMappingAudit(transformationId, destPath))
}
