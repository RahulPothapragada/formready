import SourceEvidence from './SourceEvidence';
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
              min={1}
              value={rule.value}
              onChange={(event) => onChange({ ...rule, value: Number(event.target.value) })}
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

      {rule.note ? <p className="rule-note">{rule.note}</p> : null}
      <SourceEvidence text={sourceText} span={rule.sourceSpan} />

      <div className="requirement-actions">
        <label className="confirm-toggle">
          <input
            type="checkbox"
            checked={confirmed}
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
