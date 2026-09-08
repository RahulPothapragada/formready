/**
 * Validation boundary for untrusted rule proposals.
 *
 * Anything produced by pattern extraction or an optional language model is
 * parsed through here before it reaches application state. A proposal that
 * fails to parse is discarded and surfaced as an ambiguity for the user — it is
 * never coerced into a default value, and it never becomes an executable plan.
 */

import { z } from 'zod';

export const documentKindSchema = z.enum(['photo', 'signature', 'printed', 'other']);
export const imageFormatSchema = z.enum(['jpeg', 'png']);
export const comparisonOperatorSchema = z.enum(['lt', 'lte', 'gt', 'gte', 'eq']);
export const byteConventionSchema = z.enum(['decimal', 'binary']);
export const sizeUnitSchema = z.enum(['B', 'KB', 'MB']);
export const ruleOriginSchema = z.enum(['extracted', 'manual']);
export const ruleReviewStateSchema = z.enum([
  'proposed',
  'confirmed',
  'unresolved',
  'rejected',
]);

export const sourceSpanSchema = z
  .object({
    sourceId: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    text: z.string(),
  })
  .refine((span) => span.end > span.start, {
    message: 'A source span must cover at least one character.',
  });

const ruleBaseShape = {
  id: z.string().min(1),
  origin: ruleOriginSchema,
  reviewState: ruleReviewStateSchema,
  sourceSpan: sourceSpanSchema.optional(),
  note: z.string().optional(),
};

export const formatRuleSchema = z.object({
  ...ruleBaseShape,
  field: z.literal('format'),
  allowed: z.array(imageFormatSchema).min(1),
});

export const fileSizeRuleSchema = z.object({
  ...ruleBaseShape,
  field: z.literal('fileSize'),
  operator: comparisonOperatorSchema,
  // Positive and finite: a "0 KB" or NaN limit is a parse failure, not a rule.
  value: z.number().positive().finite(),
  unit: sizeUnitSchema,
});

export const dimensionRuleSchema = z.object({
  ...ruleBaseShape,
  field: z.enum(['width', 'height']),
  operator: comparisonOperatorSchema,
  value: z.number().int().positive(),
  unit: z.literal('px'),
});

export const ruleSchema = z.discriminatedUnion('field', [
  formatRuleSchema,
  fileSizeRuleSchema,
  dimensionRuleSchema,
]);

export const manualCheckSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceSpan: sourceSpanSchema.optional(),
  acknowledged: z.boolean(),
});

/**
 * The full response contract for the optional parser (section 8). Note what is
 * absent: no transform steps, no encoder settings, no code. A model may propose
 * *what the requirements are*; it may not propose what the app should do.
 */
export const ruleProposalSchema = z.object({
  rules: z.array(ruleSchema),
  manualChecks: z.array(manualCheckSchema),
  ambiguities: z.array(
    z.object({
      text: z.string().min(1),
      reason: z.string().min(1),
      sourceSpan: sourceSpanSchema.optional(),
    }),
  ),
});

export type RuleProposal = z.infer<typeof ruleProposalSchema>;

export interface ProposalParseResult {
  proposal: RuleProposal;
  /** Entries that failed validation, kept so the user can see what was dropped. */
  rejected: Array<{ raw: unknown; reason: string }>;
}

/**
 * Parses a proposal leniently at the collection level and strictly at the item
 * level: one malformed rule is dropped and reported rather than discarding the
 * whole batch, which would lose the good rules alongside the bad one.
 */
export function parseRuleProposal(input: unknown): ProposalParseResult {
  const rejected: ProposalParseResult['rejected'] = [];
  const shell = z
    .object({
      rules: z.array(z.unknown()).default([]),
      manualChecks: z.array(z.unknown()).default([]),
      ambiguities: z.array(z.unknown()).default([]),
    })
    .safeParse(input);

  if (!shell.success) {
    return {
      proposal: { rules: [], manualChecks: [], ambiguities: [] },
      rejected: [{ raw: input, reason: 'Response was not a rule proposal object.' }],
    };
  }

  const rules = shell.data.rules.flatMap((raw) => {
    const parsed = ruleSchema.safeParse(raw);
    if (parsed.success) return [parsed.data];
    rejected.push({ raw, reason: parsed.error.issues[0]?.message ?? 'Invalid rule.' });
    return [];
  });

  const manualChecks = shell.data.manualChecks.flatMap((raw) => {
    const parsed = manualCheckSchema.safeParse(raw);
    if (parsed.success) return [parsed.data];
    rejected.push({ raw, reason: 'Invalid manual check.' });
    return [];
  });

  const ambiguities = shell.data.ambiguities.flatMap((raw) => {
    const parsed = ruleProposalSchema.shape.ambiguities.element.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });

  return { proposal: { rules, manualChecks, ambiguities }, rejected };
}
