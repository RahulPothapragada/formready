/**
 * Single job held in memory for P0.
 *
 * Persistence is deliberately absent: section 11 requires the app to state
 * plainly that reloading loses unsaved work rather than implying a recovery
 * that does not exist. IndexedDB arrives in P1 behind an explicit Save action.
 */

import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { createJob, jobReducer, type JobAction } from './jobReducer';
import type { Job } from '../domain/types';

interface JobContextValue {
  job: Job;
  dispatch: (action: JobAction) => void;
}

const JobContext = createContext<JobContextValue | null>(null);

export function JobProvider({ children }: { children: ReactNode }) {
  const [job, dispatch] = useReducer(jobReducer, undefined, () =>
    createJob(crypto.randomUUID()),
  );
  const value = useMemo(() => ({ job, dispatch }), [job]);
  return <JobContext.Provider value={value}>{children}</JobContext.Provider>;
}

export function useJob(): JobContextValue {
  const value = useContext(JobContext);
  if (!value) throw new Error('useJob must be used inside a JobProvider.');
  return value;
}
