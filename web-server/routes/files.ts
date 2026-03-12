import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import os from 'os'
import fs from 'fs'

export const router = Router()

// Upload directory for temporary files (source data, templates, etc.)
const uploadDir = path.join(os.tmpdir(), 'flux-uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_')
    cb(null, `${Date.now()}_${safe}`)
  },
})
const upload = multer({ storage })

router.post('/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) { res.status(400).send('No file received.'); return }
  res.json({ path: req.file.path, originalName: req.file.originalname })
})
