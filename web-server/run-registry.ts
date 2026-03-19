/**
 * In-memory registry mapping run IDs to the user who started them.
 * Used to scope SSE progress events to the correct user.
 * Lives for the duration of the server process — runs started before a restart
 * are already complete (or failed) so no persistence is needed.
 */
const _runOwners = new Map<string, string>()

/** Record that userId owns runId (call immediately after run start). */
export function registerRunOwner(runId: string, userId: string): void {
  _runOwners.set(runId, userId)
}

/** Return the userId who owns runId, or null if not found. */
export function getRunOwner(runId: string): string | null {
  return _runOwners.get(runId) ?? null
}

/** Remove a run from the registry (call when run is complete/failed). */
export function unregisterRun(runId: string): void {
  _runOwners.delete(runId)
}
