import { describe, expect, it } from 'vitest';
import { decryptWithPassphrase, encryptWithPassphrase } from '../src/crypto';

describe('passphrase-derived AES-GCM encryption', () => {
  it('round-trips plaintext through the correct passphrase', async () => {
    const plaintext = JSON.stringify({ aadhaar: '1234 5678 9012', pan: 'ABCDE1234F' });
    const payload = await encryptWithPassphrase(plaintext, 'correct horse battery staple');
    const decrypted = await decryptWithPassphrase(payload, 'correct horse battery staple');
    expect(decrypted).toBe(plaintext);
  });

  it('rejects the wrong passphrase instead of returning garbage', async () => {
    const payload = await encryptWithPassphrase('secret payload', 'right-passphrase');
    await expect(decryptWithPassphrase(payload, 'wrong-passphrase')).rejects.toThrow();
  });

  it('produces a different salt and ciphertext on every encryption of the same plaintext', async () => {
    const a = await encryptWithPassphrase('same plaintext', 'same-passphrase');
    const b = await encryptWithPassphrase('same plaintext', 'same-passphrase');
    expect(a.salt).not.toBe(b.salt);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
