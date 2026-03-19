import { Router } from 'express'
import { withUser } from '../../core/db.js'
import {
  createTransformation, listTransformations, getTransformation, updateTransformation,
  saveCanvas, deleteTransformation, duplicateTransformation,
  createFieldMapping, updateFieldMapping, deleteFieldMapping,
  deleteFieldMappingsByTarget, getFieldMappings, getFieldMappingsByNode,
  deleteFieldMappingsByNode,
} from '../../core/services/transformations.js'

export const router = Router()

const wrap = (fn: (body: Record<string, unknown>) => unknown) => async (req: import('express').Request, res: import('express').Response) => {
  try {
    const result = await withUser(req.user!.sub, () => fn(req.body as Record<string, unknown>))
    res.json(result)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
}

router.post('/transformations/create', wrap(({ name, description }) => createTransformation(name as string, description as string | undefined)))
router.post('/transformations/list', wrap(() => listTransformations()))
router.post('/transformations/get', wrap(({ id }) => getTransformation(id as string)))
router.post('/transformations/update', wrap(({ id, updates }) => updateTransformation(id as string, updates as object)))
router.post('/transformations/saveCanvas', wrap(({ id, canvasState }) => saveCanvas(id as string, canvasState as string)))
router.post('/transformations/delete', wrap(({ id }) => deleteTransformation(id as string)))
router.post('/transformations/duplicate', wrap(({ id }) => duplicateTransformation(id as string)))
router.post('/transformations/createFieldMapping', wrap(({ transformationId, targetObjectId, targetFieldId, ruleType, ruleConfig, notes, mapNodeId }) => createFieldMapping(transformationId as string, targetObjectId as string, targetFieldId as string, ruleType as string, ruleConfig as string, notes as string | undefined, mapNodeId as string | undefined)))
router.post('/transformations/updateFieldMapping', wrap(({ id, updates }) => updateFieldMapping(id as string, updates as object)))
router.post('/transformations/deleteFieldMapping', wrap(({ id }) => deleteFieldMapping(id as string)))
router.post('/transformations/deleteFieldMappingsByTarget', wrap(({ transformationId, targetObjectId }) => deleteFieldMappingsByTarget(transformationId as string, targetObjectId as string)))
router.post('/transformations/getFieldMappings', wrap(({ transformationId }) => getFieldMappings(transformationId as string)))
router.post('/transformations/getFieldMappingsByNode', wrap(({ mapNodeId }) => getFieldMappingsByNode(mapNodeId as string)))
router.post('/transformations/deleteFieldMappingsByNode', wrap(({ mapNodeId }) => deleteFieldMappingsByNode(mapNodeId as string)))
