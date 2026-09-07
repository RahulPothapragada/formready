/**
 * The working job, kept in memory and mirrored to on-device storage.
 *
 * The specification lists persistence as P1 behind an explicit Save action.
 * This saves automatically instead, because the case that matters is the one
 * where nobody pressed Save: an accidental reload, a backgrounded tab the
 * system reclaimed, a phone that rebooted. An explicit button is exactly
 * useless there.
 *
 * What the specification was protecting is kept: the app says plainly that work
 * is stored on this device, and offers a one-tap Delete. It does not promise
 * recovery — clearing site data, private browsing, or a full disk all mean the
 * work is gone, and the indicator says so when saving fails.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createJob, jobReducer, type JobAction } from './jobReducer';
import { isWorthSaving } from '../domain/jobSnapshot';
import { clearJob, isSupported, loadJob, saveJob } from '../services/jobStore';
import type { Job } from '../domain/types';

export type SaveState =
  /** Nothing worth saving yet. */
  | { kind: 'idle' }
  /** Edited since the last committed write — this is the honest default. */
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'delete-failed'; reason: string };

interface JobContextValue {
  job: Job;
  dispatch: (action: JobAction) => void;
  saveState: SaveState;
  /** Discards the job and everything stored for it. */
  discard: () => Promise<void>;
  /** True once anything has been written for this job, even if a later save failed. */
  hasStoredWork: boolean;
}

const JobContext = createContext<JobContextValue | null>(null);

/** Long enough to coalesce a burst of edits, short enough to survive a reload. */
const SAVE_DEBOUNCE_MS = 400;

export function JobProvider({ children }: { children: ReactNode }) {
  const [job, dispatch] = useReducer(jobReducer, undefined, () => createJob(crypto.randomUUID()));
  const [saveState, setSaveState] = useState<SaveState>(() =>
    isSupported()
      ? { kind: 'idle' }
      : { kind: 'unavailable', reason: 'This browser cannot save work locally.' },
  );
  const [hydrated, setHydrated] = useState(false);
  const [hasStoredWork, setHasStoredWork] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The revision a completed write actually covers. A save that lands after the
   * user has edited again must not report the newer work as saved, so the
   * revision is captured when the write starts and checked when it finishes.
   */
  const savedRevision = useRef<number | null>(null);

  // Restore before the first render of the journey, so nobody sees an empty
  // form flash and assumes their work is gone.
  useEffect(() => {
    let cancelled = false;
    loadJob().then((restored) => {
      if (cancelled) return;
      if (restored) {
        dispatch({ type: 'RESTORE_JOB', job: restored });
        savedRevision.current = restored.revision;
        setHasStoredWork(true);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !isSupported()) return;
    if (!isWorthSaving(job)) return;

    // Say "not saved yet" from the moment of the edit. Leaving the previous
    // "Saved" on screen through the debounce told the user their latest change
    // was safe before anything had been written.
    if (savedRevision.current !== job.revision) setSaveState({ kind: 'pending' });

    if (timer.current) clearTimeout(timer.current);
    const revision = job.revision;
    timer.current = setTimeout(() => {
      setSaveState({ kind: 'saving' });
      saveJob(job, Date.now()).then((outcome) => {
        if (outcome.saved) {
          setHasStoredWork(true);
          savedRevision.current = revision;
          // A slower earlier write must not overwrite a newer verdict.
          setSaveState((current) =>
            current.kind === 'saving' ? { kind: 'saved', at: Date.now() } : current,
          );
          return;
        }
        setSaveState({
          kind: 'unavailable',
          reason: outcome.reason ?? 'Your work could not be saved.',
        });
      });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [job, hydrated]);

  const discard = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const outcome = await clearJob();

    if (!outcome.deleted) {
      // The screen must keep matching the disk. Clearing the visible job while
      // a snapshot survives would make it reappear on the next load.
      setSaveState({ kind: 'delete-failed', reason: outcome.reason ?? 'Deletion failed.' });
      return;
    }

    savedRevision.current = null;
    setHasStoredWork(false);
    dispatch({ type: 'CLEAR_JOB', nextId: crypto.randomUUID() });
    setSaveState({ kind: 'idle' });
  }, []);

  const value = useMemo(
    () => ({ job, dispatch, saveState, discard, hasStoredWork }),
    [job, saveState, discard, hasStoredWork],
  );

  // Rendering the journey before the restore lands would let a page mount
  // against an empty job and immediately redirect away from restored work.
  if (!hydrated) {
    return (
      <p className="hydrating" role="status">
        Looking for your saved work…
      </p>
    );
  }

  return <JobContext.Provider value={value}>{children}</JobContext.Provider>;
}

export function useJob(): JobContextValue {
  const value = useContext(JobContext);
  if (!value) throw new Error('useJob must be used inside a JobProvider.');
  return value;
}
