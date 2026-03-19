/**
 * Flux web server — exposes all core services as HTTP POST endpoints.
 * Run with: npx tsx web-server/server.ts
 *
 * Projects are stored in ~/flux-projects/ by default (set FLUX_PROJECTS_DIR to override).
 * Recents list is stored in ~/.flux/recents.json.
 */
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import os from 'os'
import { configureEngine } from '../core/engine.js'
import { initUsersDb, purgeExpiredRefreshTokens } from '../core/db-users.js'
import { sseManager } from './sse.js'
import { getRunOwner } from './run-registry.js'
import { router as authRouter } from './auth.js'
import { authMiddleware } from './middleware/auth.js'
import { router as projectRouter } from './routes/project.js'
import { router as objectsRouter } from './routes/objects.js'
import { router as picklistsRouter } from './routes/picklists.js'
import { router as plmappingsRouter } from './routes/plmappings.js'
import { router as transformationsRouter } from './routes/transformations.js'
import { router as runsRouter } from './routes/runs.js'
import { router as filesRouter } from './routes/files.js'
import { router as adminRouter } from './routes/admin.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ── Validate required secrets at startup (fail fast) ────────────────────────

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET

if (!ACCESS_SECRET || ACCESS_SECRET.length < 32)
  throw new Error('JWT_ACCESS_SECRET must be set and at least 32 characters. Generate: openssl rand -hex 32')
if (!REFRESH_SECRET || REFRESH_SECRET.length < 32)
  throw new Error('JWT_REFRESH_SECRET must be set and at least 32 characters. Generate: openssl rand -hex 32')

// ── CORS (must specify origin when credentials: true) ────────────────────────

const corsOrigin = process.env.CORS_ORIGIN
if (process.env.NODE_ENV === 'production' && !corsOrigin)
  throw new Error('CORS_ORIGIN env var must be set in production.')

// ── Initialise users DB ────────────────────────────────────────────────────

initUsersDb()
purgeExpiredRefreshTokens()

// ── Configure engine ───────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10)

configureEngine({
  tempDir: path.join(os.tmpdir(), 'flux-runs'),
  sendProgress: (runId, payload) => {
    const userId = getRunOwner(runId)
    if (userId) {
      sseManager.sendToUser(userId, JSON.stringify({ runId, ...payload }))
    }
  },
})

// ── Express app ────────────────────────────────────────────────────────────

const app = express()

// Security headers (helmet sets X-Content-Type-Options, X-Frame-Options, etc.)
// CSP is disabled — the app uses inline styles via Tailwind and React
app.use(helmet({ contentSecurityPolicy: false }))

app.use(cors({
  origin: corsOrigin ?? 'http://localhost:5173',
  credentials: true,
}))

// Smaller default body limit; file routes apply their own larger limit via multer
app.use(express.json({ limit: '16kb' }))
app.use(cookieParser())

// Auth routes are public (they handle their own auth internally)
app.use('/auth', authRouter)

// All /api routes require a valid access token
app.use('/api', authMiddleware as express.RequestHandler)
app.use('/api', projectRouter)
app.use('/api', objectsRouter)
app.use('/api', picklistsRouter)
app.use('/api', plmappingsRouter)
app.use('/api', transformationsRouter)
app.use('/api', runsRouter)
app.use('/api', filesRouter)
app.use('/api', adminRouter)

// Serve the built React app from dist-web/ (web build, separate from Electron dist/)
const distDir = path.join(__dirname, '../dist-web')
app.use(express.static(distDir))

// SPA fallback: inject <base href="/"> so asset URLs are always absolute,
// regardless of the current route depth (e.g. /invite/:token).
let _indexHtml: string | null = null
function serveIndex(_req: express.Request, res: express.Response) {
  if (!_indexHtml) {
    const raw = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8')
    // Only inject if no base tag already present
    _indexHtml = raw.includes('<base ')
      ? raw
      : raw.replace('<head>', '<head><base href="/">')
  }
  res.setHeader('Content-Type', 'text/html')
  res.send(_indexHtml)
}

app.get('/{*path}', serveIndex)

app.listen(PORT, () => {
  console.log(`Flux web server running at http://localhost:${PORT}`)
})
