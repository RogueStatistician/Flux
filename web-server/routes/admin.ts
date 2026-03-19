/**
 * Admin routes — server-level management (project file listing, deletion).
 * All routes require authentication + admin role (enforced in server.ts).
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { getCurrentFilePath, getProjectsDir } from './project.js'
import { closeDatabase, isDatabaseOpen } from '../../core/db.js'
import { removeFromRecents } from '../../core/services/project.js'
import os from 'os'

export const router = Router()

const recentsFile = path.join(os.homedir(), '.flux', 'recents.json')

// GET /api/admin/projects — list all .flux files in the projects directory
router.get('/admin/projects', (_req, res) => {
  try {
    const dir = getProjectsDir()
    if (!fs.existsSync(dir)) { res.json([]); return }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.flux'))
    const currentPath = getCurrentFilePath()

    const projects = files.map(file => {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)
      return {
        filePath,
        fileName: file,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        isOpen: filePath === currentPath,
      }
    }).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))

    res.json(projects)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

// DELETE /api/admin/projects — delete a .flux file by path
router.delete('/admin/projects', (req, res) => {
  try {
    const { filePath } = req.body as { filePath?: string }
    if (!filePath || typeof filePath !== 'string') {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'filePath is required.' })
      return
    }

    // Security: only allow deleting files inside the projects directory
    const dir = getProjectsDir()
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Can only delete files within the projects directory.' })
      return
    }

    if (!fs.existsSync(resolved)) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'File not found.' })
      return
    }

    // If this file is currently open, close it first
    if (isDatabaseOpen() && getCurrentFilePath() === resolved) {
      closeDatabase()
    }

    fs.unlinkSync(resolved)
    removeFromRecents(recentsFile, resolved)
    res.json({})
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})
