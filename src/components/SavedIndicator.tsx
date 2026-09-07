import { useState } from 'react';
import { useJob } from '../app/JobContext';
import { describeSnapshot, isWorthSaving } from '../domain/jobSnapshot';

/**
 * States what is stored and offers to delete it.
 *
 * The app saves without being asked, so it owes the user two things in return:
 * a plain statement of what is on this device, and a way to remove it that
 * takes one tap.
 *
 * Two rules the wording has to keep:
 *
 *   - "Saved" means a write committed for the *current* revision. While an edit
 *     is still waiting on its write, this says so. Reporting work as safe
 *     before it is written is the failure persistence exists to prevent.
 *   - Delete stays available whenever anything may still be stored, including
 *     when a later save failed. Losing the delete control at exactly the moment
 *     storage misbehaves leaves the user no way to remove an older snapshot.
 */
export default function SavedIndicator() {
  const { job, saveState, discard, hasStoredWork } = useJob();
  const [confirming, setConfirming] = useState(false);

  if (!isWorthSaving(job) && !hasStoredWork) return null;

  if (confirming) {
    return (
      <div className="saved-indicator confirming" role="alertdialog" aria-label="Delete saved work">
        <p>Delete your {describeSnapshot(job)} from this device? This cannot be undone.</p>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              void discard();
              setConfirming(false);
            }}
          >
            Delete it
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      </div>
    );
  }

  const deleteButton = hasStoredWork ? (
    <button type="button" className="link" onClick={() => setConfirming(true)}>
      Delete
    </button>
  ) : null;

  if (saveState.kind === 'delete-failed') {
    return (
      <p className="saved-indicator failing" role="alert">
        <span>
          <strong>Not deleted.</strong> {saveState.reason}
        </span>
        <button type="button" className="link" onClick={() => void discard()}>
          Try again
        </button>
      </p>
    );
  }

  if (saveState.kind === 'unavailable') {
    return (
      <p className="saved-indicator failing" role="alert">
        <span>
          <strong>Not saved.</strong> {saveState.reason}
          {hasStoredWork
            ? ' An earlier version may still be stored on this device.'
            : ' Closing this page will lose your work.'}
        </span>
        {deleteButton}
      </p>
    );
  }

  if (saveState.kind === 'pending' || saveState.kind === 'saving') {
    return (
      <p className="saved-indicator pending" role="status">
        <span>Saving your latest change…</span>
        {deleteButton}
      </p>
    );
  }

  if (saveState.kind === 'idle') return null;

  return (
    <p className="saved-indicator" role="status">
      <span>
        Saved on this phone — your {describeSnapshot(job)} will still be here if you close this
        page.
      </span>
      {deleteButton}
    </p>
  );
}
