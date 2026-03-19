/**
 * Auth router — login, logout, refresh, register, /me, and admin user management.
 *
 * Security properties:
 * - httpOnly cookies, SameSite=Strict, Secure (when HTTPS env var is set)
 * - Access token: 15 min, Path=/
 * - Refresh token: 24 h, Path=/auth/refresh only (scoped — not sent to other endpoints)
 * - Refresh tokens tracked in DB (jti allowlist) → real revocation + reuse detection
 * - bcrypt.compare() always runs (prevents timing-based user enumeration)
 * - Generic error messages (no difference between "user not found" and "wrong password")
 * - Zod input validation on all routes
 * - Rate limiting applied per-route (see server.ts for limiter definitions)
 * - iss + aud claims validated on every jwt.verify() call
 */
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import {
  getUserCount,
  createUser,
  verifyPassword,
  getUserById,
  listUsers,
  deleteUser,
  createRefreshToken,
  rotateRefreshToken,
  deleteRefreshToken,
  wipeUserRefreshTokens,
  lookupRefreshToken,
} from '../core/services/users.js'
import { authMiddleware, requireAdmin, softAuth, ACCESS_SECRET } from './middleware/auth.js'

const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!

// ── Cookie options ─────────────────────────────────────────────────────────────

const SECURE = !!process.env.HTTPS

const cookieBase = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: SECURE,
}

function setTokenCookies(
  res: import('express').Response,
  accessToken: string,
  refreshToken: string
): void {
  res.cookie('flux_access', accessToken, {
    ...cookieBase,
    path: '/',
    maxAge: 15 * 60 * 1000,          // 15 minutes
  })
  res.cookie('flux_refresh', refreshToken, {
    ...cookieBase,
    path: '/auth/refresh',            // scoped — only sent to this endpoint
    maxAge: 24 * 60 * 60 * 1000,     // 24 hours
  })
}

function clearTokenCookies(res: import('express').Response): void {
  res.cookie('flux_access',  '', { ...cookieBase, path: '/',             maxAge: 0 })
  res.cookie('flux_refresh', '', { ...cookieBase, path: '/auth/refresh', maxAge: 0 })
}

// ── Token helpers ──────────────────────────────────────────────────────────────

function signAccessToken(user: { id: string; username: string; role: string }): string {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    ACCESS_SECRET,
    { expiresIn: '15m', issuer: 'flux', audience: 'flux-web' }
  )
}

function signRefreshToken(jti: string, userId: string): string {
  return jwt.sign(
    { sub: userId, jti },
    REFRESH_SECRET,
    { expiresIn: '24h', issuer: 'flux', audience: 'flux-web' }
  )
}

function refreshTokenExpiresAt(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

// ── Rate limiters ──────────────────────────────────────────────────────────────

const loginLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false })
const refreshLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false })
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max:  5, standardHeaders: true, legacyHeaders: false })

// ── Zod schemas ───────────────────────────────────────────────────────────────

const LoginSchema    = z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(1024) })
const RegisterSchema = z.object({ username: z.string().min(1).max(128), password: z.string().min(8).max(1024) })

// ── Router ────────────────────────────────────────────────────────────────────

export const router = Router()

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ code: 'INVALID_REQUEST' }); return }

  const { username, password } = parsed.data
  const user = await verifyPassword(username, password)

  if (!user) {
    res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' })
    return
  }

  const jti = crypto.randomUUID()
  const accessToken  = signAccessToken(user)
  const refreshToken = signRefreshToken(jti, user.id)
  createRefreshToken(jti, user.id, refreshTokenExpiresAt())
  setTokenCookies(res, accessToken, refreshToken)

  res.json({ id: user.id, username: user.username, role: user.role })
})

// POST /auth/logout
router.post('/logout', (req, res) => {
  const token: string | undefined = req.cookies?.flux_refresh
  if (token) {
    try {
      const payload = jwt.verify(token, REFRESH_SECRET, { issuer: 'flux', audience: 'flux-web' }) as jwt.JwtPayload
      if (payload.jti) deleteRefreshToken(payload.jti)
    } catch { /* expired or invalid — still clear cookies */ }
  }
  clearTokenCookies(res)
  res.json({})
})

// POST /auth/refresh
router.post('/refresh', refreshLimiter, async (req, res) => {
  const token: string | undefined = req.cookies?.flux_refresh
  if (!token) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }

  let payload: jwt.JwtPayload
  try {
    payload = jwt.verify(token, REFRESH_SECRET, { issuer: 'flux', audience: 'flux-web' }) as jwt.JwtPayload
  } catch {
    res.status(401).json({ code: 'UNAUTHORIZED' })
    return
  }

  const { jti, sub: userId } = payload
  if (!jti || !userId) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }

  // Look up stored jti — if missing, token was already rotated (reuse detected)
  const storedUserId = lookupRefreshToken(jti)
  if (!storedUserId) {
    // Compromise suspected — wipe all sessions for this user
    wipeUserRefreshTokens(userId)
    clearTokenCookies(res)
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Session invalidated. Please log in again.' })
    return
  }

  const user = getUserById(userId)
  if (!user) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }

  const newJti = crypto.randomUUID()
  const expiresAt = refreshTokenExpiresAt()
  const rotated = rotateRefreshToken(jti, newJti, userId, expiresAt)
  if (!rotated) {
    // Race condition: another request already consumed this jti
    wipeUserRefreshTokens(userId)
    clearTokenCookies(res)
    res.status(401).json({ code: 'UNAUTHORIZED' })
    return
  }

  const accessToken  = signAccessToken(user)
  const refreshToken = signRefreshToken(newJti, user.id)
  setTokenCookies(res, accessToken, refreshToken)

  res.json({ id: user.id, username: user.username, role: user.role })
})

// POST /auth/register
// softAuth sets req.user if a token is present, but does not reject unauthenticated requests
// (required for the first-user bootstrap where no token exists yet).
router.post('/register', registerLimiter, softAuth as import('express').RequestHandler, async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_REQUEST', message: 'Username and password are required (min 8 chars for password)' })
    return
  }

  const { username, password } = parsed.data

  // Determine role and check authorisation inside a transaction (eliminates TOCTOU race)
  let role: 'admin' | 'user' = 'user'
  let registrationAllowed = false

  const db = (await import('../core/db-users.js')).getUsersDb()
  const check = db.transaction(() => {
    const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c

    if (count === 0) {
      // First user: open registration — becomes admin
      role = 'admin'
      registrationAllowed = true
      return
    }

    // Bootstrap token bypass for admin recovery
    const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN
    if (bootstrapToken && req.headers['x-bootstrap-token'] === bootstrapToken) {
      role = 'admin'
      registrationAllowed = true
      return
    }

    // Otherwise: must be an authenticated admin (authMiddleware already ran)
    if (req.user?.role === 'admin') {
      role = 'user'
      registrationAllowed = true
    }
  })
  check()

  if (!registrationAllowed) {
    res.status(403).json({ code: 'FORBIDDEN', message: 'Registration is closed. An admin must create your account.' })
    return
  }

  try {
    const user = await createUser(username, password, role)
    res.status(201).json({ id: user.id, username: user.username, role: user.role })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('UNIQUE constraint')) {
      res.status(409).json({ code: 'USERNAME_TAKEN', message: 'That username is already taken.' })
    } else {
      res.status(500).json({ code: 'INTERNAL_ERROR' })
    }
  }
})

// GET /auth/me — protected
router.get('/me', authMiddleware as import('express').RequestHandler, (req, res) => {
  const user = getUserById(req.user!.sub)
  if (!user) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
  res.json({ id: user.id, username: user.username, role: user.role })
})

// ── Admin user management ─────────────────────────────────────────────────────

// GET /auth/users — list all users (admin only)
router.get(
  '/users',
  authMiddleware as import('express').RequestHandler,
  requireAdmin as import('express').RequestHandler,
  (_req, res) => {
    res.json(listUsers())
  }
)

// DELETE /auth/users/:id — delete a user (admin only, cannot delete self)
router.delete(
  '/users/:id',
  authMiddleware as import('express').RequestHandler,
  requireAdmin as import('express').RequestHandler,
  (req, res) => {
    const targetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    if (targetId === req.user!.sub) {
      res.status(400).json({ code: 'CANNOT_DELETE_SELF' })
      return
    }
    deleteUser(targetId)
    res.json({})
  }
)
