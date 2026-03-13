import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { openDatabase, closeDatabase, isDatabaseOpen } from '../../core/db.js'
import {
  createProjectRecord, openProjectRecord, updateProjectRecord,
  getProjectMetaRecord, loadRecents, addToRecents, removeFromRecents, deleteProjectFile,
} from '../../core/services/project.js'

export const router = Router()

const projectsDir = process.env.FLUX_PROJECTS_DIR ?? path.join(os.homedir(), 'flux-projects')
const recentsFile = path.join(os.homedir(), '.flux', 'recents.json')

let _currentFilePath: string | null = null

function ensureProjectsDir() {
  fs.mkdirSync(projectsDir, { recursive: true })
}

router.post('/project/create', (req, res) => {
  try {
    ensureProjectsDir()
    const { name, description, client } = req.body as { name: string; description?: string; client?: string }
    const safe = name.replace(/[^a-zA-Z0-9_\-. ]/g, '_').replace(/\s+/g, '_')
    const filePath = path.join(projectsDir, `${safe}_${Date.now()}.flux`)
    openDatabase(filePath)
    _currentFilePath = filePath
    const record = createProjectRecord(name, description, client)
    addToRecents(recentsFile, filePath, name)
    res.json({ id: record.id, name: record.name, description: record.description ?? undefined, client: record.client ?? undefined, createdAt: record.created_at, updatedAt: record.updated_at, filePath })
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/open', (req, res) => {
  try {
    const { filePath } = req.body as { filePath: string }
    const meta = openProjectRecord(filePath)
    _currentFilePath = filePath
    addToRecents(recentsFile, filePath, meta.name)
    res.json(meta)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/close', (_req, res) => {
  try { closeDatabase(); _currentFilePath = null; res.json(null) }
  catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/update', (req, res) => {
  try {
    const { fields } = req.body as { fields: Partial<{ name: string; description: string; client: string }> }
    res.json(updateProjectRecord(_currentFilePath ?? '', fields))
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/getMeta', (_req, res) => {
  try {
    if (!isDatabaseOpen() || !_currentFilePath) { res.json(null); return }
    res.json(getProjectMetaRecord(_currentFilePath))
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/listRecents', (_req, res) => {
  try { res.json(loadRecents(recentsFile)) }
  catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/removeRecent', (req, res) => {
  try {
    const { filePath } = req.body as { filePath: string }
    removeFromRecents(recentsFile, filePath)
    res.json(null)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/delete', (_req, res) => {
  try {
    if (!_currentFilePath) throw new Error('No project is open.')
    const filePath = _currentFilePath
    _currentFilePath = null
    deleteProjectFile(recentsFile, filePath)
    res.json(null)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})
