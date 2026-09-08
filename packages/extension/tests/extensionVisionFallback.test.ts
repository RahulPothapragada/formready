import { describe, expect, it, vi } from 'vitest';
import { classifyFieldsWithVision, VISION_MODEL, type VisionCandidate } from '../src/visionFallback';

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('classifyFieldsWithVision', () => {
  const candidates: VisionCandidate[] = [
    { fieldId: 'f1', domGuess: 'aadhaar', label: 'Aadhaar Number' },
    { fieldId: 'f2', domGuess: null, label: 'Mystery field' },
  ];

  it('sends the screenshot as a base64 image block and the candidates as structured text, targeting the agreed model', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(VISION_MODEL);
      expect(body.output_config.format.type).toBe('json_schema');
      expect(body.messages[0].content[0]).toMatchObject({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'ZmFrZS1wbmc=' },
      });
      expect(body.messages[0].content[1].text).toContain('f1');
      expect(body.messages[0].content[1].text).toContain('Aadhaar Number');
      return fakeResponse({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              fields: [
                { fieldId: 'f1', confirmedType: 'aadhaar', confidence: 0.95 },
                { fieldId: 'f2', confirmedType: null, confidence: 0.1 },
              ],
            }),
          },
        ],
      });
    });

    const results = await classifyFieldsWithVision(
      'data:image/png;base64,ZmFrZS1wbmc=',
      candidates,
      'sk-ant-test-key',
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { fieldId: 'f1', confirmedType: 'aadhaar', confidence: 0.95 },
      { fieldId: 'f2', confirmedType: null, confidence: 0.1 },
    ]);
  });

  it('never puts the API key anywhere except the request header', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.body as string).not.toContain('sk-ant-secret');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-secret');
      return fakeResponse({ content: [{ type: 'text', text: '{"fields":[]}' }] });
    });

    await classifyFieldsWithVision('data:image/png;base64,AAAA', [], 'sk-ant-secret', fetchImpl as unknown as typeof fetch);
  });

  it('throws with the response body when the API call fails', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ error: 'bad key' }, false, 401));
    await expect(
      classifyFieldsWithVision('data:image/png;base64,AAAA', candidates, 'bad-key', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/401/);
  });
});
