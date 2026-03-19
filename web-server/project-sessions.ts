/**
 * Project session + lock manager.
 *
 * Tracks which user has which project currently open (write lock).
 * Locks are in-memory only — intentionally not persisted so a server
 * restart releases all stale locks automatically.
 *
 * Lock semantics:
 *  - Only one user may hold the write lock on a given project at a time.
 *  - A second user's open attempt returns the existing LockInfo (caller → 423).
 *  - Locks are released on explicit close, logout, or LOCK_TIMEOUT_MS idle.
 */

export interface LockInfo {
  userId: string
  username: string
  lockedAt: string   // ISO timestamp
}

const LOCK_TIMEOUT_MS = 2 * 60 * 60 * 1000  // 2 hours idle → auto-release

class ProjectSessionManager {
  /** projectUuid → LockInfo */
  private locks = new Map<string, LockInfo & { timer: ReturnType<typeof setTimeout> }>()

  /** userId → projectUuid */
  private sessions = new Map<string, string>()

  /**
   * Attempt to acquire the write lock on `projectUuid` for `userId`.
   * Returns `null` on success, or the existing `LockInfo` if another user holds it.
   */
  tryLock(projectUuid: string, userId: string, username: string): LockInfo | null {
    const existing = this.locks.get(projectUuid)
    if (existing && existing.userId !== userId) {
      const { userId: lu, username: lun, lockedAt } = existing
      return { userId: lu, username: lun, lockedAt }
    }

    // Release any project this user already has open
    this.release(userId)

    const timer = setTimeout(() => this.release(userId), LOCK_TIMEOUT_MS)
    // Allow garbage collection even if the process lingers
    if (timer.unref) timer.unref()

    const lockedAt = new Date().toISOString()
    this.locks.set(projectUuid, { userId, username, lockedAt, timer })
    this.sessions.set(userId, projectUuid)
    return null
  }

  /**
   * Release the lock held by `userId` (if any). Safe to call when no lock is held.
   */
  release(userId: string): void {
    const projectUuid = this.sessions.get(userId)
    if (!projectUuid) return

    const lock = this.locks.get(projectUuid)
    if (lock?.userId === userId) {
      clearTimeout(lock.timer)
      this.locks.delete(projectUuid)
    }
    this.sessions.delete(userId)
  }

  /** Return the LockInfo for a project, or null if unlocked. */
  getLock(projectUuid: string): LockInfo | null {
    const lock = this.locks.get(projectUuid)
    if (!lock) return null
    return { userId: lock.userId, username: lock.username, lockedAt: lock.lockedAt }
  }

  /** Return the projectUuid the user currently has open, or null. */
  getUserSession(userId: string): string | null {
    return this.sessions.get(userId) ?? null
  }

  /** Return all active locks (for admin display). */
  getAllLocks(): Array<LockInfo & { projectUuid: string }> {
    return Array.from(this.locks.entries()).map(([projectUuid, lock]) => ({
      projectUuid,
      userId: lock.userId,
      username: lock.username,
      lockedAt: lock.lockedAt,
    }))
  }

  /**
   * Force-release a lock (admin action — e.g. before deleting a project).
   * Also closes the DB connection for the affected user.
   */
  forceRelease(projectUuid: string): void {
    const lock = this.locks.get(projectUuid)
    if (!lock) return
    clearTimeout(lock.timer)
    this.locks.delete(projectUuid)
    this.sessions.delete(lock.userId)
  }
}

export const sessionManager = new ProjectSessionManager()
