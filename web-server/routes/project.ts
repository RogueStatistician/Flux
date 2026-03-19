import { Router } from 'express'
import path from 'path'
import os from 'os'
import fs from 'fs'
import {
  openDatabase, closeDatabase, isDatabaseOpen, withUser, getCurrentFilePath,
} from '../../core/db.js'
import {
  createProjectRecord, updateProjectRecord, getProjectMetaRecord,
  loadRecents, addToRecents, removeFromRecents, deleteProjectFile,
} from '../../core/services/project.js'
import {
  registerProject, getProjectAccess, listAccessibleProjects,
  getProjectUuidByPath, unregisterProject,
  shareProject, revokeAccess, listProjectMembers,
} from '../../core/services/projects-registry.js'
import { listUsers } from '../../core/services/users.js'
import { sessionManager } from '../project-sessions.js'

export const router = Router()

const projectsDir = process.env.FLUX_PROJECTS_DIR ?? path.join(os.homedir(), 'flux-projects')
const recentsFile = path.join(os.homedir(), '.flux', 'recents.json')

/** Used by the admin router to know where .flux files live. */
export function getProjectsDir(): string { return projectsDir }

function ensureProjectsDir() {
  fs.mkdirSync(projectsDir, { recursive: true })
}

// ── Helper: get project UUID for the requesting user's open session ───────────

function getSessionUuid(userId: string): string | null {
  return sessionManager.getUserSession(userId)
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

router.post('/project/create', async (req, res) => {
  try {
    ensureProjectsDir()
    const userId   = req.user!.sub
    const username = req.user!.username

    const { name, description, client } = req.body as { name: string; description?: string; client?: string }
    const safe     = name.replace(/[^a-zA-Z0-9_\-. ]/g, '_').replace(/\s+/g, '_')
    const filePath = path.join(projectsDir, `${safe}_${Date.now()}.flux`)

    openDatabase(userId, filePath)

    const record = withUser(userId, () => createProjectRecord(name, description, client))
    const projectUuid = record.id

    // Register ownership and acquire lock
    registerProject(projectUuid, filePath, userId)
    sessionManager.tryLock(projectUuid, userId, username)

    addToRecents(recentsFile, filePath, name)
    res.json({
      id: record.id, name: record.name,
      description: record.description ?? undefined,
      client: record.client ?? undefined,
      createdAt: record.created_at, updatedAt: record.updated_at,
      filePath,
    })
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/open', async (req, res) => {
  try {
    const userId   = req.user!.sub
    const username = req.user!.username
    const { filePath } = req.body as { filePath: string }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Project file not found.' })
      return
    }

    // Open temporarily (read-only probe) to get the project UUID
    const probeDb = (await import('better-sqlite3')).default
    const tempDb  = new probeDb(filePath, { readonly: true })
    const projectRow = tempDb.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined
    tempDb.close()

    if (!projectRow) {
      res.status(400).json({ code: 'INVALID_FILE', message: 'Not a valid .flux project file.' })
      return
    }

    const projectUuid = projectRow.id

    // Register project if first time seen (admin-opened or legacy file)
    registerProject(projectUuid, filePath, userId)

    // Check access
    const access = getProjectAccess(projectUuid, userId)
    if (!access) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'You do not have access to this project.' })
      return
    }
    if (access === 'viewer') {
      res.status(403).json({ code: 'VIEWER_ONLY', message: 'You have viewer-only access. Use download instead.' })
      return
    }

    // Check lock
    const lockInfo = sessionManager.tryLock(projectUuid, userId, username)
    if (lockInfo) {
      res.status(423).json({
        code: 'LOCKED',
        message: `This project is currently open by ${lockInfo.username}.`,
        lockedBy: lockInfo.username,
        lockedAt: lockInfo.lockedAt,
      })
      return
    }

    openDatabase(userId, filePath)
    const meta = withUser(userId, () => getProjectMetaRecord(filePath))
    addToRecents(recentsFile, filePath, meta?.name ?? path.basename(filePath))
    res.json(meta)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/close', (req, res) => {
  try {
    const userId = req.user!.sub
    closeDatabase(userId)
    sessionManager.release(userId)
    res.json(null)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/update', (req, res) => {
  try {
    const userId = req.user!.sub
    const filePath = getCurrentFilePath(userId) ?? ''
    const { fields } = req.body as { fields: Partial<{ name: string; description: string; client: string }> }
    const result = withUser(userId, () => updateProjectRecord(filePath, fields))
    res.json(result)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

router.post('/project/getMeta', (req, res) => {
  try {
    const userId = req.user!.sub
    if (!isDatabaseOpen(userId)) { res.json(null); return }
    const filePath = getCurrentFilePath(userId) ?? ''
    res.json(withUser(userId, () => getProjectMetaRecord(filePath)))
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

// ── Project listing (replaces recents for web) ────────────────────────────────

router.post('/project/list', (req, res) => {
  try {
    const userId = req.user!.sub
    const projects = listAccessibleProjects(userId)
    const allLocks = sessionManager.getAllLocks()

    const result = projects.map(p => {
      const lock = allLocks.find(l => l.projectUuid === p.projectUuid)
      return {
        ...p,
        isLocked: !!lock,
        lockedBy: lock && lock.userId !== userId ? lock.username : null,
        isOpenByMe: lock?.userId === userId,
      }
    })
    res.json(result)
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

router.post('/project/delete', (req, res) => {
  try {
    const userId = req.user!.sub
    const filePath = getCurrentFilePath(userId)
    if (!filePath) throw new Error('No project is open.')

    const projectUuid = getSessionUuid(userId)
    closeDatabase(userId)
    sessionManager.release(userId)

    deleteProjectFile(recentsFile, filePath)
    if (projectUuid) unregisterProject(projectUuid)
    res.json(null)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * GET /api/project/download?uuid=<projectUuid>
 * Download a .flux file. The user must have at least viewer access.
 * Does not require the project to be currently open.
 */
router.get('/project/download', (req, res) => {
  try {
    const userId = req.user!.sub
    const { uuid } = req.query as { uuid?: string }

    let filePath: string | null = null
    let projectUuid = uuid ?? null

    if (projectUuid) {
      // Download by UUID (works even if not open)
      const access = getProjectAccess(projectUuid, userId)
      if (!access) {
        res.status(403).json({ code: 'FORBIDDEN' }); return
      }
      const projects = listAccessibleProjects(userId)
      filePath = projects.find(p => p.projectUuid === projectUuid)?.filePath ?? null
    } else {
      // Download currently open project
      filePath = getCurrentFilePath(userId)
      if (filePath) {
        projectUuid = getProjectUuidByPath(filePath)
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Project file not found.' }); return
    }

    const fileName = path.basename(filePath)
    res.download(filePath, fileName)
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

// ── Sharing ───────────────────────────────────────────────────────────────────

/**
 * GET /api/project/members — list who has access to the current project.
 * Requires the project to be open.
 */
router.get('/project/members', (req, res) => {
  try {
    const userId = req.user!.sub
    const projectUuid = getSessionUuid(userId)
    if (!projectUuid) { res.status(400).json({ code: 'NO_PROJECT_OPEN' }); return }

    const access = getProjectAccess(projectUuid, userId)
    if (!access || access === 'viewer') {
      res.status(403).json({ code: 'FORBIDDEN' }); return
    }

    res.json(listProjectMembers(projectUuid))
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

/**
 * POST /api/project/share { userId, role }
 * Owner-only: share the current open project with another user.
 */
router.post('/project/share', (req, res) => {
  try {
    const userId = req.user!.sub
    const projectUuid = getSessionUuid(userId)
    if (!projectUuid) { res.status(400).json({ code: 'NO_PROJECT_OPEN' }); return }

    if (!isOwnerOf(projectUuid, userId)) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only the project owner can share.' })
      return
    }

    const { userId: targetId, role } = req.body as { userId?: string; role?: unknown }
    if (!targetId || typeof targetId !== 'string') {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'userId is required.' }); return
    }
    if (role !== 'editor' && role !== 'viewer') {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'role must be editor or viewer.' }); return
    }
    if (targetId === userId) {
      res.status(400).json({ code: 'INVALID_REQUEST', message: 'Cannot share with yourself.' }); return
    }

    shareProject(projectUuid, targetId, role, userId)
    res.json(listProjectMembers(projectUuid))
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

/**
 * DELETE /api/project/share/:targetUserId
 * Owner-only: revoke a user's access to the current open project.
 */
router.delete('/project/share/:targetUserId', (req, res) => {
  try {
    const userId = req.user!.sub
    const projectUuid = getSessionUuid(userId)
    if (!projectUuid) { res.status(400).json({ code: 'NO_PROJECT_OPEN' }); return }

    if (!isOwnerOf(projectUuid, userId)) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only the project owner can revoke access.' })
      return
    }

    const targetId = Array.isArray(req.params.targetUserId)
      ? req.params.targetUserId[0]
      : req.params.targetUserId

    revokeAccess(projectUuid, targetId)
    res.json(listProjectMembers(projectUuid))
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

/**
 * GET /api/project/users — list all users (for share dialog autocomplete).
 * Returns only id + username (no sensitive fields).
 */
router.get('/project/users', (req, res) => {
  try {
    const userId = req.user!.sub
    const projectUuid = getSessionUuid(userId)
    if (!projectUuid) { res.status(400).json({ code: 'NO_PROJECT_OPEN' }); return }

    const access = getProjectAccess(projectUuid, userId)
    if (!access || access === 'viewer') {
      res.status(403).json({ code: 'FORBIDDEN' }); return
    }

    const users = listUsers()
    res.json(users.map(u => ({ id: u.id, username: u.username, systemRole: u.role })))
  } catch (e) { res.status(500).send(e instanceof Error ? e.message : String(e)) }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOwnerOf(projectUuid: string, userId: string): boolean {
  return getProjectAccess(projectUuid, userId) === 'owner'
}
