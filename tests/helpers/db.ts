/**
 * Test DB helpers — open a fresh in-memory SQLite DB for each test suite.
 * Each vitest worker gets its own module instance, so the global _db in
 * core/db.ts is isolated per file — no cross-file state leakage.
 */
import { openDatabase, closeDatabase } from '../../core/db.js'
import os from 'os'
import path from 'path'
import fs from 'fs'

/**
 * Open a fresh in-memory SQLite DB.
 * Returns a cleanup function that closes it.
 */
export function openMemoryDb(): () => void {
  openDatabase(':memory:')
  return () => closeDatabase()
}

/**
 * Open a temp-file SQLite DB (use when the test needs a real file path,
 * e.g. for project service tests that use fs.unlinkSync).
 * Returns the file path and a cleanup function.
 */
export function openTempDb(): { filePath: string; cleanup: () => void } {
  const filePath = path.join(
    os.tmpdir(),
    `flux-test-${Date.now()}-${Math.random().toString(36).slice(2)}.flux`
  )
  openDatabase(filePath)
  return {
    filePath,
    cleanup: () => {
      closeDatabase()
      try { fs.unlinkSync(filePath) } catch { /* already gone */ }
    },
  }
}
