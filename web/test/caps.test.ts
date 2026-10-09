import { describe, expect, it } from 'vitest';
import { chatCaps } from '@/lib/caps';

describe('chatCaps', () => {
  it('uses generous defaults when nothing is configured', () => {
    expect(chatCaps({})).toEqual({ perCaller: 200, global: 1000 });
  });
  it('reads overrides from env', () => {
    expect(chatCaps({ CHAT_PER_CALLER_DAILY: '500', CHAT_GLOBAL_DAILY: '1400' })).toEqual({ perCaller: 500, global: 1400 });
  });
  it('ignores junk values instead of turning chat off', () => {
    expect(chatCaps({ CHAT_PER_CALLER_DAILY: 'lots', CHAT_GLOBAL_DAILY: '-5' })).toEqual({ perCaller: 200, global: 1000 });
  });
});
