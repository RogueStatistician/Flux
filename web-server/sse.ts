/**
 * SSE (Server-Sent Events) manager for broadcasting run progress events.
 * Events are scoped per user — each user only receives their own run progress.
 */
import type { Response } from 'express'

class SseManager {
  private clients = new Map<string, Set<Response>>()

  addClient(userId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    if (!this.clients.has(userId)) this.clients.set(userId, new Set())
    this.clients.get(userId)!.add(res)

    res.on('close', () => {
      this.clients.get(userId)?.delete(res)
      if (this.clients.get(userId)?.size === 0) this.clients.delete(userId)
    })
  }

  /** Send a progress event only to the user who owns the run. */
  sendToUser(userId: string, data: string): void {
    for (const res of this.clients.get(userId) ?? []) {
      try { res.write(`data: ${data}\n\n`) } catch { /* client disconnected */ }
    }
  }

  /** Close all SSE connections for a user (e.g. on forced logout / token expiry). */
  closeUserConnections(userId: string): void {
    for (const res of this.clients.get(userId) ?? []) {
      try { res.end() } catch { /* already closed */ }
    }
    this.clients.delete(userId)
  }
}

export const sseManager = new SseManager()
