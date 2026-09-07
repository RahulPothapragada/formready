import { useState } from 'react';
import { useJob } from '../app/JobContext';
import { describeSnapshot, isWorthSaving } from '../domain/jobSnapshot';

/**
 * States what is stored and offers to delete it.
 *
 * The app saves without being asked, so it owes the user two things in return:
 * a plain statement that their document is on this device, and a way to remove
 * it that takes one tap. Neither is buried in a settings screen.
 *
 * It does not promise recovery. Storage can be cleared by the browser, by the
 * system under pressure, or by private browsing ending — so when saving fails,
 * this says so rather than staying quiet.
 */
export default function SavedIndicator() {
  const { job, saveState, discard } = useJob();
  const [confirming, setConfirming] = useState(false);

  if (!isWorthSaving(job)) return null;

  if (saveState.kind === 'unavailable') {
    return (
      <p className="saved-indicator unavailable" role="status">
        <strong>Not saved.</strong> {saveState.reason} Closing this page will lose your work.
      </p>
    );
  }

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

  return (
    <p className="saved-indicator" role="status">
      <span>
        {saveState.kind === 'saving' ? 'Saving' : 'Saved'} on this phone — your{' '}
        {describeSnapshot(job)} will still be here if you close this page.
      </span>
      <button type="button" className="link" onClick={() => setConfirming(true)}>
        Delete
      </button>
    </p>
  );
}
