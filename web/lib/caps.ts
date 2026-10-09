import { createHmac } from 'node:crypto';
import { sql } from './db';

const positiveInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// Raise these in Vercel during judging if needed; the global cap should sit just under Gemini's free daily limit.
export function chatCaps(env: Record<string, string | undefined> = process.env) {
  return { perCaller: positiveInt(env.CHAT_PER_CALLER_DAILY, 200), global: positiveInt(env.CHAT_GLOBAL_DAILY, 1000) };
}

// Visitors without a wallet are counted by a keyed hash of their IP; the IP itself is never stored.
export function callerKey(req: Request, wallet: string | null): string {
  if (wallet) return `wallet:${wallet}`;
  const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  return `ip:${createHmac('sha256', process.env.CRON_SECRET || 'chog-buddy').update(ip).digest('hex')}`;
}

export async function bumpChatUsage(key: string): Promise<number> {
  const [{ count }] = await sql`
    insert into chat_usage (key, day, count) values (${key}, current_date, 1)
    on conflict (key, day) do update set count = chat_usage.count + 1
    returning count`;
  return count;
}
