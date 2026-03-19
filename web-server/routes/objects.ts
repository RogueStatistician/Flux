import { Router } from 'express'
import { withUser } from '../../core/db.js'
import type { ParseOptions } from '../../core/importer.js'
import {
  inferSchemaFromFile, inferSchemaFromHeadersOnly, createObject, listObjects,
  getObject, updateObject, deleteObject, importRows, getRows, upsertFields,
} from '../../core/services/objects.js'

export const router = Router()

type Req = import('express').Request
type Res = import('express').Response

/** Wrap a handler that needs the user's DB context. */
const wrap = (fn: (body: Record<string, unknown>) => unknown) =>
  async (req: Req, res: Res) => {
    try {
      const result = await withUser(req.user!.sub, () => fn(req.body as Record<string, unknown>))
      res.json(result)
    } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
  }

router.post('/objects/inferSchema',         wrap(({ filePath, options }) => inferSchemaFromFile(filePath as string, options as ParseOptions | undefined)))
router.post('/objects/inferSchemaFromHeaders', wrap(({ filePath, options }) => inferSchemaFromHeadersOnly(filePath as string, options as ParseOptions | undefined)))
router.post('/objects/create',              wrap(({ role, name, description, systemName, outputFormat, templateConfig }) => createObject(role as 'source' | 'target', name as string, description as string | undefined, systemName as string | undefined, (outputFormat ?? 'xlsx') as 'xlsx' | 'csv', templateConfig as object | undefined)))
router.post('/objects/list',                wrap(({ role }) => listObjects(role as 'source' | 'target' | undefined)))
router.post('/objects/get',                 wrap(({ id }) => getObject(id as string)))
router.post('/objects/update',              wrap(({ id, updates }) => updateObject(id as string, updates as object)))
router.post('/objects/delete',              wrap(({ id }) => deleteObject(id as string)))
router.post('/objects/importRows',          wrap(({ id, filePath, options }) => importRows(id as string, filePath as string, options as ParseOptions | undefined)))
router.post('/objects/getRows',             wrap(({ id, offset, limit }) => getRows(id as string, offset as number, limit as number)))
router.post('/fields/upsert',               wrap(({ objectId, fields }) => upsertFields(objectId as string, fields as Parameters<typeof upsertFields>[1])))
