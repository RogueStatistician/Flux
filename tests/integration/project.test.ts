import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createProjectRecord,
  openProjectRecord,
  closeProjectRecord,
  updateProjectRecord,
  getProjectMetaRecord,
  loadRecents,
  addToRecents,
  removeFromRecents,
} from '../../core/services/project.js'
import { openMemoryDb, openTempDb } from '../helpers/db.js'
import { closeDatabase } from '../../core/db.js'
import os from 'os'
import path from 'path'
import fs from 'fs'

// ── createProjectRecord ────────────────────────────────────────────────────

describe('createProjectRecord', () => {
  let closeDb: () => void
  beforeEach(() => { closeDb = openMemoryDb() })
  afterEach(() => closeDb())

  it('creates a project and returns metadata', () => {
    const p = createProjectRecord('Test Project', 'desc', 'Acme Corp')
    expect(p.name).toBe('Test Project')
    expect(p.description).toBe('desc')
    expect(p.client).toBe('Acme Corp')
    expect(p.id).toBeTruthy()
    expect(p.created_at).toBeTruthy()
  })

  it('assigns a UUID as id', () => {
    const p = createProjectRecord('P')
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('allows null description and client', () => {
    const p = createProjectRecord('P')
    expect(p.description).toBeNull()
    expect(p.client).toBeNull()
  })
})

// ── openProjectRecord / closeProjectRecord / getProjectMetaRecord ──────────

describe('openProjectRecord', () => {
  it('opens a .flux file and returns project metadata', () => {
    const { filePath, cleanup } = openTempDb()
    try {
      createProjectRecord('My Project', 'A description', 'Client A')
      closeDatabase()

      const meta = openProjectRecord(filePath)
      expect(meta.name).toBe('My Project')
      expect(meta.description).toBe('A description')
      expect(meta.client).toBe('Client A')
      expect(meta.filePath).toBe(filePath)
    } finally {
      try { closeDatabase() } catch { /* ignore */ }
      cleanup()
    }
  })

  it('throws when opening an invalid file (empty file)', () => {
    const filePath = path.join(os.tmpdir(), `bad-${Date.now()}.flux`)
    try {
      // Write a non-SQLite file
      fs.writeFileSync(filePath, 'not a database', 'utf-8')
      expect(() => openProjectRecord(filePath)).toThrow()
    } finally {
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }
  })
})

describe('getProjectMetaRecord', () => {
  let closeDb: () => void
  beforeEach(() => { closeDb = openMemoryDb() })
  afterEach(() => closeDb())

  it('returns null when no DB is open', () => {
    closeDb()
    // DB is now closed
    expect(getProjectMetaRecord(':memory:')).toBeNull()
    closeDb = () => { /* already closed */ }
  })

  it('returns project meta when DB is open and has a project', () => {
    createProjectRecord('Proj', 'desc')
    const meta = getProjectMetaRecord(':memory:')
    expect(meta?.name).toBe('Proj')
  })
})

// ── updateProjectRecord ────────────────────────────────────────────────────

describe('updateProjectRecord', () => {
  let closeDb: () => void
  beforeEach(() => { closeDb = openMemoryDb() })
  afterEach(() => closeDb())

  it('updates the project name', () => {
    createProjectRecord('Old Name')
    const updated = updateProjectRecord(':memory:', { name: 'New Name' })
    expect(updated.name).toBe('New Name')
  })

  it('updates description and client independently', () => {
    createProjectRecord('P')
    let updated = updateProjectRecord(':memory:', { description: 'New Desc' })
    expect(updated.description).toBe('New Desc')
    updated = updateProjectRecord(':memory:', { client: 'Acme' })
    expect(updated.client).toBe('Acme')
  })

  it('updates updated_at timestamp', async () => {
    createProjectRecord('P')
    const before = getProjectMetaRecord(':memory:')!.updatedAt
    await new Promise(r => setTimeout(r, 5))
    updateProjectRecord(':memory:', { name: 'P2' })
    const after = getProjectMetaRecord(':memory:')!.updatedAt
    expect(after >= before).toBe(true)
  })
})

// ── loadRecents / addToRecents / removeFromRecents ─────────────────────────

describe('recents management', () => {
  let recentsFile: string

  beforeEach(() => {
    recentsFile = path.join(os.tmpdir(), `flux-recents-test-${Date.now()}.json`)
  })
  afterEach(() => { try { fs.unlinkSync(recentsFile) } catch { /* ignore */ } })

  it('loadRecents returns [] when file does not exist', () => {
    expect(loadRecents('/nonexistent/recents.json')).toEqual([])
  })

  it('loadRecents returns [] for invalid JSON', () => {
    fs.writeFileSync(recentsFile, 'not json', 'utf-8')
    expect(loadRecents(recentsFile)).toEqual([])
  })

  it('addToRecents creates the file and adds an entry', () => {
    addToRecents(recentsFile, '/path/to/project.flux', 'My Project')
    const recents = loadRecents(recentsFile)
    expect(recents).toHaveLength(1)
    expect(recents[0].filePath).toBe('/path/to/project.flux')
    expect(recents[0].name).toBe('My Project')
  })

  it('addToRecents moves existing entry to front (deduplication)', () => {
    addToRecents(recentsFile, '/a.flux', 'A')
    addToRecents(recentsFile, '/b.flux', 'B')
    addToRecents(recentsFile, '/a.flux', 'A updated')
    const recents = loadRecents(recentsFile)
    expect(recents[0].filePath).toBe('/a.flux')
    expect(recents[0].name).toBe('A updated')
    expect(recents).toHaveLength(2)
  })

  it('addToRecents keeps only the 10 most recent entries', () => {
    for (let i = 0; i < 12; i++) {
      addToRecents(recentsFile, `/project${i}.flux`, `Project ${i}`)
    }
    expect(loadRecents(recentsFile)).toHaveLength(10)
  })

  it('removeFromRecents removes the specified entry', () => {
    addToRecents(recentsFile, '/a.flux', 'A')
    addToRecents(recentsFile, '/b.flux', 'B')
    removeFromRecents(recentsFile, '/a.flux')
    const recents = loadRecents(recentsFile)
    expect(recents).toHaveLength(1)
    expect(recents[0].filePath).toBe('/b.flux')
  })
})
