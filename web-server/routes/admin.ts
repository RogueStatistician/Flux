/**
 * Admin routes — server-level management (project registry listing, deletion, download).
 * All routes require authentication + admin role (enforced in server.ts).
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { closeDatabase } from '../../core/db.js'
import { removeFromRecents } from '../../core/services/project.js'
import { listAllProjects, unregisterProject } from '../../core/services/projects-registry.js'
import { sessionManager } from '../project-sessions.js'
import os from 'os'

export const router = Router()

const recentsFile = path.join(os.homedir(), '.flux', 'recents.json')

// GET /api/admin/projects — list all registered projects with owner + lock info
router.get('/admin/projects', (_req, res) => {
  try {
    const projects = listAllProjects()
    const allLocks = sessionManager.getAllLocks()

    const result = projects.map(p => {
      const lock = allLocks.find(l => l.projectUuid === p.projectUuid)
      const exists = fs.existsSync(p.filePath)
      const stat = exists ? fs.statSync(p.filePath) : null
      return {
        projectUuid: p.projectUuid,
        filePath: p.filePath,
        fileName: p.fileName,
        ownerUsername: p.ownerUsername,
        ownerId: p.ownerId,
        sizeBytes: stat?.size ?? 0,
        modifiedAt: stat?.mtime.toISOString() ?? p.registeredAt,
        exists,
        isLocked: !!lock,
        lockedBy: lock?.username ?? null,
        lockedAt: lock?.lockedAt ?? null,
      }
    })

    res.json(result)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

// DELETE /api/admin/projects — delete a .flux file by projectUuid or filePath
router.delete('/admin/projects', (req, res) => {
  try {
    const { filePath, projectUuid } = req.body as { filePath?: string; projectUuid?: string }

    let resolvedPath: string | undefined
    let uuid: string | undefined = projectUuid

    if (filePath) {
      resolvedPath = path.resolve(filePath)
    } else if (projectUuid) {
      const projects = listAllProjects()
      const entry = projects.find(p => p.projectUuid === projectUuid)
      if (!entry) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Project not found in registry.' })
        return
      }
      resolvedPath = path.resolve(entry.filePath)
    } else {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'filePath or projectUuid is required.' })
      return
    }

    // Force-release any active lock (closes DB connection too)
    if (uuid) {
      const lock = sessionManager.getLock(uuid)
      if (lock) {
        closeDatabase(lock.userId)
        sessionManager.forceRelease(uuid)
      }
    }

    if (resolvedPath && fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath)
    }

    if (uuid) {
      unregisterProject(uuid)
    }
    if (resolvedPath) {
      removeFromRecents(recentsFile, resolvedPath)
    }

    res.json({})
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

// GET /api/admin/projects/download?filePath=... — download any .flux file (admin only)
router.get('/admin/projects/download', (req, res) => {
  try {
    const filePath = req.query.filePath as string | undefined
    if (!filePath) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'filePath query param is required.' })
      return
    }

    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'File not found.' })
      return
    }

    res.download(resolved, path.basename(resolved))
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})
