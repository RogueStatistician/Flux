import { Router } from 'express'
import fs from 'fs'
import { executeTransformation, cancelRun } from '../../core/engine.js'
import { getRun, listRuns, getRunIssues, previewOutput } from '../../core/services/runs.js'
import { sseManager } from '../sse.js'
import { getDb } from '../../core/db.js'

export const router = Router()

const wrap = (fn: (body: Record<string, unknown>) => unknown) => async (req: import('express').Request, res: import('express').Response) => {
  try { res.json(await fn(req.body as Record<string, unknown>)) }
  catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
}

// SSE stream for run progress
router.get('/run/progress', (req, res) => {
  sseManager.addClient(res)
})

router.post('/run/start', wrap(({ transformationId }) => executeTransformation(transformationId as string)))
router.post('/run/cancel', wrap(({ runId }) => { cancelRun(runId as string); return null }))
router.post('/run/get', wrap(({ runId }) => getRun(runId as string)))
router.post('/run/list', wrap(({ transformationId }) => listRuns(transformationId as string | undefined)))
router.post('/run/getIssues', wrap(({ runId, severity }) => getRunIssues(runId as string, severity as string | undefined)))
router.post('/run/previewOutput', wrap(({ runId, targetObjectId, limit }) => previewOutput(runId as string, targetObjectId as string, (limit as number | undefined) ?? 100)))

// Download output file
router.get('/run/download/:runId/:targetObjectId', (req, res) => {
  try {
    const { runId, targetObjectId } = req.params
    const db = getDb()
    const row = db.prepare('SELECT output_manifest FROM runs WHERE id = ?').get(runId) as { output_manifest: string | null } | undefined
    if (!row?.output_manifest) { res.status(404).send('No output manifest for this run.'); return }
    const manifest = JSON.parse(row.output_manifest) as { targets: Array<{ objectId: string; filePath: string; objectName: string; format: string }> }
    const target = manifest.targets.find(t => t.objectId === targetObjectId)
    if (!target) { res.status(404).send('Target not found in manifest.'); return }
    if (!fs.existsSync(target.filePath)) { res.status(410).send('Output file has been cleaned up. Re-run the transformation.'); return }
    const ext = target.format === 'csv' ? '.csv' : '.xlsx'
    const filename = `${target.objectName.replace(/[^a-zA-Z0-9_\- ]/g, '_')}${ext}`
    res.download(target.filePath, filename)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})
