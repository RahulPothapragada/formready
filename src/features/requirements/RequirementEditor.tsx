import { useState } from 'react';
import SourceEvidence from './SourceEvidence';
import { ruleProblem } from '../../domain/constraints';
import type { ComparisonOperator, Rule, SizeUnit } from '../../domain/types';

interface RequirementEditorProps {
  rule: Rule;
  sourceText: string;
  onChange: (rule: Rule) => void;
  onRemove: (ruleId: string) => void;
}

const OPERATOR_LABEL: Record<ComparisonOperator, string> = {
  lt: 'less than',
  lte: 'at most',
  gt: 'more than',
  gte: 'at least',
  eq: 'exactly',
};

const FIELD_LABEL: Record<Rule['field'], string> = {
  format: 'File format',
  fileSize: 'File size',
  width: 'Width',
  height: 'Height',
};

/**
 * One editable rule.
 *
 * The operator is a first-class control rather than a hidden assumption,
 * because "under 50 KB" and "up to 50 KB" pass different files and the
 * instructions are often written loosely (section 6).
 */
export default function RequirementEditor({
  rule,
  sourceText,
  onChange,
  onRemove,
}: RequirementEditorProps) {
  const confirmed = rule.reviewState === 'confirmed';
  const [draft, setDraft] = useState<string | null>(null);
  const problem = ruleProblem(rule);

  return (
    <li className={`requirement ${rule.reviewState}`}>
      <div className="requirement-head">
        <h3>{FIELD_LABEL[rule.field]}</h3>
        <span className={`origin-badge ${rule.origin}`}>
          {rule.origin === 'extracted' ? 'From instructions' : 'Entered by you'}
        </span>
      </div>

      {rule.field === 'format' ? (
        <fieldset>
          <legend>Allowed formats</legend>
          {(['jpeg', 'png'] as const).map((format) => (
            <label key={format}>
              <input
                type="checkbox"
                checked={rule.allowed.includes(format)}
                onChange={(event) => {
                  const allowed = event.target.checked
                    ? [...rule.allowed, format]
                    : rule.allowed.filter((value) => value !== format);
                  if (allowed.length === 0) return; // Never allow an empty set.
                  onChange({ ...rule, allowed });
                }}
              />
              {format.toUpperCase()}
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="requirement-value">
          <label>
            <span className="visually-hidden">Comparison</span>
            <select
              value={rule.operator}
              onChange={(event) =>
                onChange({ ...rule, operator: event.target.value as ComparisonOperator })
              }
            >
              {Object.entries(OPERATOR_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="visually-hidden">Value</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              // Held as text while editing: clearing the field would otherwise
              // read back as Number('') === 0 and become a zero-pixel rule.
              value={draft ?? String(rule.value)}
              onChange={(event) => {
                const next = event.target.value;
                setDraft(next);
                const parsed = Number(next);
                if (next.trim() !== '' && Number.isFinite(parsed)) {
                  onChange({ ...rule, value: parsed });
                }
              }}
              onBlur={() => setDraft(null)}
              aria-invalid={problem ? true : undefined}
            />
          </label>
          {rule.field === 'fileSize' ? (
            <label>
              <span className="visually-hidden">Unit</span>
              <select
                value={rule.unit}
                onChange={(event) => onChange({ ...rule, unit: event.target.value as SizeUnit })}
              >
                <option value="B">bytes</option>
                <option value="KB">KB</option>
                <option value="MB">MB</option>
              </select>
            </label>
          ) : (
            <span className="unit">pixels</span>
          )}
        </div>
      )}

      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {rule.note ? <p className="rule-note">{rule.note}</p> : null}
      <SourceEvidence text={sourceText} span={rule.sourceSpan} />

      <div className="requirement-actions">
        <label className="confirm-toggle">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={problem !== null && !confirmed}
            onChange={(event) =>
              onChange({ ...rule, reviewState: event.target.checked ? 'confirmed' : 'proposed' })
            }
          />
          Use this requirement
        </label>
        <button type="button" className="link" onClick={() => onRemove(rule.id)}>
          Remove
        </button>
      </div>
    </li>
  );
}
