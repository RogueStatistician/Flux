import { Router } from 'express'
import { withUser } from '../../core/db.js'
import {
  createPlMapping, listPlMappings, getPlMapping, updatePlMapping, deletePlMapping,
  setPlMappingEntries, importPlMappingEntriesFromFile, bulkImportPlMappingsFromFile,
} from '../../core/services/plmappings.js'

export const router = Router()

const wrap = (fn: (body: Record<string, unknown>) => unknown) => async (req: import('express').Request, res: import('express').Response) => {
  try {
    const result = await withUser(req.user!.sub, () => fn(req.body as Record<string, unknown>))
    res.json(result)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
}

router.post('/plmappings/create', wrap(({ name, sourcePicklistId, targetPicklistId }) => createPlMapping(name as string, sourcePicklistId as string | undefined, targetPicklistId as string | undefined)))
router.post('/plmappings/list', wrap(() => listPlMappings()))
router.post('/plmappings/get', wrap(({ id }) => getPlMapping(id as string)))
router.post('/plmappings/update', wrap(({ id, updates }) => updatePlMapping(id as string, updates as object)))
router.post('/plmappings/delete', wrap(({ id }) => deletePlMapping(id as string)))
router.post('/plmappings/setEntries', wrap(({ id, entries }) => setPlMappingEntries(id as string, entries as Array<{ sourceKey: string; targetKey: string }>)))
router.post('/plmappings/importEntriesFromFile', wrap(({ id, filePath, sourceKeyCol, targetKeyCol }) => importPlMappingEntriesFromFile(id as string, filePath as string, sourceKeyCol as string, targetKeyCol as string)))
router.post('/plmappings/bulkImportFromFile', wrap(({ filePath }) => bulkImportPlMappingsFromFile(filePath as string)))
