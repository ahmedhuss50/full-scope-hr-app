'use server'
// Legacy actions file — `proposeInterview` lives at /app/hr/applications/[id]/actions.ts
// under the multi-module suite. Re-exported so any stale references keep resolving.
export { proposeInterview } from '../../hr/applications/[id]/actions'
