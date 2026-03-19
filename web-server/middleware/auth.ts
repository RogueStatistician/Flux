/**
 * JWT access-token verification middleware.
 * Reads the flux_access httpOnly cookie and attaches req.user on success.
 */
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

// Validated and exported so auth.ts can reuse the same secret reference
export const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.flux_access
  if (!token) {
    res.status(401).json({ code: 'UNAUTHORIZED' })
    return
  }

  try {
    const payload = jwt.verify(token, ACCESS_SECRET, {
      issuer: 'flux',
      audience: 'flux-web',
    }) as jwt.JwtPayload & { sub: string; username: string; role: string }
    req.user = payload
    next()
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      res.status(401).json({ code: 'TOKEN_EXPIRED' })
    } else {
      res.status(401).json({ code: 'UNAUTHORIZED' })
    }
  }
}

/** Require the authenticated user to have admin role. Must be used after authMiddleware. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ code: 'FORBIDDEN' })
    return
  }
  next()
}

/**
 * Soft auth: sets req.user if a valid access token is present but does NOT
 * reject on missing or expired tokens. Use for routes that allow both
 * authenticated and unauthenticated access (e.g. /auth/register for first user).
 */
export function softAuth(req: Request, _res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.flux_access
  if (token) {
    try {
      req.user = jwt.verify(token, ACCESS_SECRET, {
        issuer: 'flux',
        audience: 'flux-web',
      }) as jwt.JwtPayload & { sub: string; username: string; role: string }
    } catch { /* no-op — caller checks req.user */ }
  }
  next()
}
