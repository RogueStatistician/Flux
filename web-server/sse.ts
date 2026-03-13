/**
 * SSE (Server-Sent Events) manager for broadcasting run progress events.
 * Replaces BrowserWindow.webContents.send() in the Electron version.
 */
import type { Response } from 'express'

class SseManager {
  private clients = new Set<Response>()

  addClient(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.flushHeaders()
    this.clients.add(res)
    res.on('close', () => this.clients.delete(res))
  }

  broadcast(data: string): void {
    for (const res of this.clients) {
      try { res.write(`data: ${data}\n\n`) } catch { /* client disconnected */ }
    }
  }
}

export const sseManager = new SseManager()
