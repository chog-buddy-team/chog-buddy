// A wipe (sign-out, lost ownership, Clear chat history) must not be undone by a write that started before it.
export function createWipeGuard() {
  let n = 0;
  return { epoch: () => n, bump: () => void n++, stale: (startedAt: number) => startedAt !== n };
}
