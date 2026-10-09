import { describe, expect, it } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createSiweMessage, generateSiweNonce } from 'viem/siwe';
import { AuthError, verifyLogin } from '@/lib/auth';

const account = privateKeyToAccount(generatePrivateKey());
const domain = 'buddy.chog.test';

function msg(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  return createSiweMessage({
    address: account.address,
    chainId: 143,
    domain,
    nonce: generateSiweNonce(),
    uri: `https://${domain}`,
    version: '1',
    issuedAt: new Date(),
    ...overrides,
  });
}

describe('verifyLogin', () => {
  it('accepts a valid signature and returns address + nonce', async () => {
    const message = msg();
    const signature = await account.signMessage({ message });
    const r = await verifyLogin(message, signature, { domain });
    expect(r.address).toBe(account.address);
    expect(r.nonce).toMatch(/\w{8,}/);
  });

  it('rejects another domain', async () => {
    const message = msg({ domain: 'evil.test', uri: 'https://evil.test' });
    const signature = await account.signMessage({ message });
    await expect(verifyLogin(message, signature, { domain })).rejects.toThrow(AuthError);
  });

  it('rejects a signature from another wallet', async () => {
    const message = msg();
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await other.signMessage({ message });
    await expect(verifyLogin(message, signature, { domain })).rejects.toThrow(AuthError);
  });

  it('rejects stale messages (issued > 10 min ago)', async () => {
    const message = msg({ issuedAt: new Date(Date.now() - 11 * 60_000) });
    const signature = await account.signMessage({ message });
    await expect(verifyLogin(message, signature, { domain })).rejects.toThrow(/stale/);
  });

  it('rejects expired messages', async () => {
    const message = msg({ expirationTime: new Date(Date.now() - 1000) });
    const signature = await account.signMessage({ message });
    await expect(verifyLogin(message, signature, { domain })).rejects.toThrow(/expired/);
  });

  it('rejects garbage', async () => {
    await expect(verifyLogin('hello', '0x00', { domain })).rejects.toThrow(AuthError);
  });
});
