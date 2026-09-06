import { useNavigate } from 'react-router-dom';
import type { PreparationFailure } from '../domain/types';

interface RecoveryPanelProps {
  failure: PreparationFailure;
}

const ACTION_LABEL: Record<PreparationFailure['suggestions'][number], string> = {
  'adjust-crop': 'Adjust crop',
  'review-requirements': 'Review requirements',
  'choose-clearer-image': 'Choose a clearer image',
};

const ACTION_PATH: Record<PreparationFailure['suggestions'][number], string> = {
  'adjust-crop': '/document',
  'review-requirements': '/requirements',
  'choose-clearer-image': '/document',
};

/**
 * NEEDS_FIX state. Each failure kind carries its own message and its own set of
 * next steps, because "no candidate found within this search" and "this size
 * limit is unreachable for PNG" call for different actions from the user
 * (section 12, NFR-07). The original file and the confirmed rules survive.
 */
export default function RecoveryPanel({ failure }: RecoveryPanelProps) {
  const navigate = useNavigate();

  return (
    <section className="recovery-panel" role="alert">
      <h2>We couldn&rsquo;t finish this one</h2>
      <p>{failure.message}</p>
      <p className="hint">
        Your original file is still here, and nothing has been changed.
      </p>
      <div className="actions">
        {failure.suggestions.map((suggestion) => (
          <button key={suggestion} type="button" onClick={() => navigate(ACTION_PATH[suggestion])}>
            {ACTION_LABEL[suggestion]}
          </button>
        ))}
      </div>
    </section>
  );
}
