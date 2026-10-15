import { sql } from './db';

// Run by the daily cron so abandoned sign-ins and old sessions can't pile up in the free Neon tier.
export async function cleanupExpired(): Promise<{ nonces: number; sessions: number; diaryUsage: number }> {
  const nonces = await sql`delete from nonces where created_at < now() - interval '10 minutes' returning 1`;
  const sessions = await sql`delete from sessions where created_at < now() - interval '30 days' returning 1`;
  const diaryUsage = await sql`delete from diary_usage where day < current_date - 7 returning 1`;
  await sql`delete from chat_usage where day < current_date - 7`;
  await sql`delete from focus_settling where locked_at < now() - interval '1 day'`;
  return { nonces: nonces.length, sessions: sessions.length, diaryUsage: diaryUsage.length };
}
