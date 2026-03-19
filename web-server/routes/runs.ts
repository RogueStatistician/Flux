import { Router } from 'express'
import fs from 'fs'
import { executeTransformation, cancelRun } from '../../core/engine.js'
import { getRun, listRuns, getRunIssues, previewOutput } from '../../core/services/runs.js'
import { sseManager } from '../sse.js'
import { registerRunOwner, unregisterRun } from '../run-registry.js'
import { withUser, getDb } from '../../core/db.js'

export const router = Router()

const wrap = (fn: (body: Record<string, unknown>) => unknown) => async (req: import('express').Request, res: import('express').Response) => {
  try {
    const result = await withUser(req.user!.sub, () => fn(req.body as Record<string, unknown>))
    res.json(result)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
}

// SSE stream for run progress — scoped to the authenticated user
router.get('/run/progress', (req, res) => {
  const userId = req.user?.sub
  if (!userId) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
  sseManager.addClient(userId, res)
})

// Start a run and register the requesting user as the owner of that run
router.post('/run/start', async (req, res) => {
  try {
    const userId = req.user!.sub
    const { transformationId } = req.body as Record<string, unknown>
    // executeTransformation needs the DB context
    const runId = await withUser(userId, () => executeTransformation(transformationId as string))
    registerRunOwner(runId, userId)
    setTimeout(() => unregisterRun(runId), 60 * 60 * 1000)  // 1 hour TTL
    res.json(runId)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/run/cancel',        wrap(({ runId }) => { cancelRun(runId as string); return null }))
router.post('/run/get',           wrap(({ runId }) => getRun(runId as string)))
router.post('/run/list',          wrap(({ transformationId }) => listRuns(transformationId as string | undefined)))
router.post('/run/getIssues',     wrap(({ runId, severity }) => getRunIssues(runId as string, severity as string | undefined)))
router.post('/run/previewOutput', wrap(({ runId, targetObjectId, limit }) => previewOutput(runId as string, targetObjectId as string, (limit as number | undefined) ?? 100)))

// Download output file — uses withUser to scope getDb() to the requesting user
router.get('/run/download/:runId/:targetObjectId', (req, res) => {
  try {
    const userId = req.user!.sub
    const { runId, targetObjectId } = req.params

    const row = withUser(userId, () =>
      getDb().prepare('SELECT output_manifest FROM runs WHERE id = ?').get(runId) as { output_manifest: string | null } | undefined
    )

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
