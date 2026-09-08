import { useState } from 'react';
import type { ComparisonOperator, ImageFormat, Rule, SizeUnit } from '@formready/engine';

interface AddRequirementProps {
  onAdd: (rule: Rule) => void;
}

type Field = 'fileSize' | 'width' | 'height' | 'format';

const FIELD_LABEL: Record<Field, string> = {
  fileSize: 'File size',
  width: 'Width',
  height: 'Height',
  format: 'File format',
};

const OPERATOR_LABEL: Record<ComparisonOperator, string> = {
  lte: 'at most',
  lt: 'less than',
  gte: 'at least',
  gt: 'more than',
  eq: 'exactly',
};

/**
 * Lets the user state a requirement the instructions did not supply.
 *
 * Section 6 requires this: when no actionable exact constraint was extracted,
 * the app has to ask for a preparation target rather than inventing one. Until
 * this existed the requirements screen told people to "set a target yourself"
 * and then gave them no way to do it.
 *
 * Everything added here is marked `origin: 'manual'`, so the review screen can
 * show it as the user's own choice rather than as evidence read from the form.
 */
export default function AddRequirement({ onAdd }: AddRequirementProps) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<Field>('fileSize');
  const [operator, setOperator] = useState<ComparisonOperator>('lte');
  const [value, setValue] = useState('50');
  const [unit, setUnit] = useState<SizeUnit>('KB');
  const [formats, setFormats] = useState<ImageFormat[]>(['jpeg']);

  const submit = () => {
    const id = `manual-${field}-${crypto.randomUUID().slice(0, 8)}`;

    if (field === 'format') {
      onAdd({
        id,
        field: 'format',
        allowed: formats,
        origin: 'manual',
        // Typed deliberately by the user, so it needs no second confirmation.
        reviewState: 'confirmed',
      });
    } else {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return;
      onAdd(
        field === 'fileSize'
          ? { id, field, operator, value: numeric, unit, origin: 'manual', reviewState: 'confirmed' }
          : {
              id,
              field,
              operator,
              value: Math.round(numeric),
              unit: 'px',
              origin: 'manual',
              reviewState: 'confirmed',
            },
      );
    }

    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="add-requirement-trigger" onClick={() => setOpen(true)}>
        + Add a requirement yourself
      </button>
    );
  }

  return (
    <div className="add-requirement">
      <h4>Add a requirement</h4>
      <p className="hint">
        Use this when the instructions do not say, or the app could not read it. It will be marked
        as your choice, not as something we found.
      </p>

      <div className="add-requirement-fields">
        <label>
          <span>What</span>
          <select value={field} onChange={(event) => setField(event.target.value as Field)}>
            {(Object.keys(FIELD_LABEL) as Field[]).map((key) => (
              <option key={key} value={key}>
                {FIELD_LABEL[key]}
              </option>
            ))}
          </select>
        </label>

        {field === 'format' ? (
          <fieldset>
            <legend>Allowed</legend>
            {(['jpeg', 'png'] as const).map((option) => (
              <label key={option} className="inline">
                <input
                  type="checkbox"
                  checked={formats.includes(option)}
                  onChange={(event) =>
                    setFormats((current) => {
                      const next = event.target.checked
                        ? [...current, option]
                        : current.filter((item) => item !== option);
                      // Never allow an empty set: that would forbid every file.
                      return next.length > 0 ? next : current;
                    })
                  }
                />
                {option.toUpperCase()}
              </label>
            ))}
          </fieldset>
        ) : (
          <>
            <label>
              <span>Must be</span>
              <select
                value={operator}
                onChange={(event) => setOperator(event.target.value as ComparisonOperator)}
              >
                {(Object.keys(OPERATOR_LABEL) as ComparisonOperator[]).map((key) => (
                  <option key={key} value={key}>
                    {OPERATOR_LABEL[key]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Value</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <label>
              <span>Unit</span>
              {field === 'fileSize' ? (
                <select value={unit} onChange={(event) => setUnit(event.target.value as SizeUnit)}>
                  <option value="KB">KB</option>
                  <option value="MB">MB</option>
                  <option value="B">bytes</option>
                </select>
              ) : (
                <input type="text" value="pixels" readOnly />
              )}
            </label>
          </>
        )}
      </div>

      <div className="actions">
        <button type="button" className="primary" onClick={submit}>
          Add requirement
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
