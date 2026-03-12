/**
 * Flux web server — exposes all core services as HTTP POST endpoints.
 * Run with: npx tsx web-server/server.ts
 *
 * Projects are stored in ~/flux-projects/ by default (set FLUX_PROJECTS_DIR to override).
 * Recents list is stored in ~/.flux/recents.json.
 */
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import os from 'os'
import { configureEngine } from '../core/engine.js'
import { sseManager } from './sse.js'
import { router as projectRouter } from './routes/project.js'
import { router as objectsRouter } from './routes/objects.js'
import { router as picklistsRouter } from './routes/picklists.js'
import { router as plmappingsRouter } from './routes/plmappings.js'
import { router as transformationsRouter } from './routes/transformations.js'
import { router as runsRouter } from './routes/runs.js'
import { router as filesRouter } from './routes/files.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = parseInt(process.env.PORT ?? '3001', 10)

// Configure the engine with web-specific platform hooks before any routes are hit
configureEngine({
  tempDir: path.join(os.tmpdir(), 'flux-runs'),
  sendProgress: (runId, payload) => {
    sseManager.broadcast(JSON.stringify({ runId, ...payload }))
  },
})

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

app.use('/api', projectRouter)
app.use('/api', objectsRouter)
app.use('/api', picklistsRouter)
app.use('/api', plmappingsRouter)
app.use('/api', transformationsRouter)
app.use('/api', runsRouter)
app.use('/api', filesRouter)

// Serve the built React app from dist/ (production only)
const distDir = path.join(__dirname, '../dist')
app.use(express.static(distDir))
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Flux web server running at http://localhost:${PORT}`)
})
