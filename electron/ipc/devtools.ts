/**
 * Dev tools IPC handlers — DB browser and transformation query renderer.
 */
import { ipcMain } from 'electron'
import { listTables, queryTable, executeRawQuery, renderTransformationQuery } from '../../core/services/devtools.js'

export function registerDevtoolsHandlers(): void {
  ipcMain.handle('devtools:listTables', async () => listTables())
  ipcMain.handle('devtools:queryTable', async (_e, tableName: string, page: number, pageSize: number) =>
    queryTable(tableName, page, pageSize))
  ipcMain.handle('devtools:rawQuery', async (_e, sql: string) => executeRawQuery(sql))
  ipcMain.handle('devtools:renderQuery', async (_e, transformationId: string) =>
    renderTransformationQuery(transformationId))
}
