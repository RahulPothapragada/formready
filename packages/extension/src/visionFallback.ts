/**
 * Vision-based double-check for fields the DOM classifier is unsure about.
 *
 * Runs only in the background service worker (has fetch, is the only
 * context allowed to call chrome.tabs.captureVisibleTab). The screenshot
 * shows the blank/generic form layout only — never a filled-in value,
 * never actual PII — because its job is field *identification*, not data
 * processing. The API key and every profile value stay out of the prompt
 * entirely.
 */

import { PROFILE_FIELD_KEYS, type ProfileFieldKey } from './profile';

export const VISION_MODEL = 'claude-sonnet-5';

export interface VisionCandidate {
  fieldId: string;
  domGuess: ProfileFieldKey | null;
  label: string;
}

export interface VisionResult {
  fieldId: string;
  confirmedType: ProfileFieldKey | null;
  confidence: number;
}

function buildSchema() {
  return {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fieldId: { type: 'string' },
            confirmedType: { type: ['string', 'null'], enum: [...PROFILE_FIELD_KEYS, null] },
            confidence: { type: 'number' },
          },
          required: ['fieldId', 'confirmedType', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['fields'],
    additionalProperties: false,
  };
}

function buildPrompt(candidates: VisionCandidate[]): string {
  const lines = candidates
    .map((c) => `- id=${c.fieldId}, DOM guess=${c.domGuess ?? 'none'}, label text="${c.label}"`)
    .join('\n');
  return (
    `You are looking at a screenshot of a web form. For each candidate field below, confirm what ` +
    `kind of personal-information field it is, using the visual layout and labels — the DOM guess ` +
    `may be wrong. Reply null for a field that matches none of the listed types. Never invent a ` +
    `value; classify the field's TYPE only.\n\nCandidates:\n${lines}\n\nValid types: ` +
    `${PROFILE_FIELD_KEYS.join(', ')}, or null.`
  );
}

/** `fetchImpl` is injectable so the request/response contract can be tested without a real API call. */
export async function classifyFieldsWithVision(
  screenshotDataUrl: string,
  candidates: VisionCandidate[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VisionResult[]> {
  const base64 = screenshotDataUrl.split(',')[1] ?? '';

  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 1024,
      output_config: { format: { type: 'json_schema', schema: buildSchema() } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
            { type: 'text', text: buildPrompt(candidates) },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision classification failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const textBlock = data.content?.find((block) => block.type === 'text');
  if (!textBlock?.text) throw new Error('The model did not return structured output.');

  const parsed = JSON.parse(textBlock.text) as { fields: VisionResult[] };
  return parsed.fields;
}
