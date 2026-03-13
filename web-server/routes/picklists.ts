import { Router } from 'express'
import {
  createPicklist, listPicklists, getPicklist, updatePicklist, deletePicklist,
  setPicklistValues, importPicklistFromFile, bulkImportPicklistsFromFile,
} from '../../core/services/picklists.js'

export const router = Router()

const wrap = (fn: (body: Record<string, unknown>) => unknown) => async (req: import('express').Request, res: import('express').Response) => {
  try { res.json(await fn(req.body as Record<string, unknown>)) }
  catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
}

router.post('/picklists/create', wrap(({ side, name, description }) => createPicklist(side as 'source' | 'target', name as string, description as string | undefined)))
router.post('/picklists/list', wrap(({ side }) => listPicklists(side as 'source' | 'target' | undefined)))
router.post('/picklists/get', wrap(({ id }) => getPicklist(id as string)))
router.post('/picklists/update', wrap(({ id, updates }) => updatePicklist(id as string, updates as object)))
router.post('/picklists/delete', wrap(({ id }) => deletePicklist(id as string)))
router.post('/picklists/setValues', wrap(({ id, values }) => setPicklistValues(id as string, values as Array<{ key: string; label?: string }>)))
router.post('/picklists/importFromFile', wrap(({ id, filePath, keyCol, labelCol }) => importPicklistFromFile(id as string, filePath as string, keyCol as string, labelCol as string | undefined)))
router.post('/picklists/bulkImportFromFile', wrap(({ filePath, side }) => bulkImportPicklistsFromFile(filePath as string, side as 'source' | 'target')))
