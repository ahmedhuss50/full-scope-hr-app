'use server'
// Legacy actions file — `createJob` lives at /app/hr/jobs/new/actions.ts under
// the multi-module suite. Re-exported so any stale references keep resolving.
export { createJob } from '../../hr/jobs/new/actions'
