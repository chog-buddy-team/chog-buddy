import { cleanupExpired } from '@/lib/cleanup';
import { isCronAuthorized } from '@/lib/cron-auth';
import { seedDemoActivity } from '@/lib/demo';
import { sweepExpiredBets } from '@/lib/focus-sweep';
import { runSoulJob } from '@/lib/soul-job';

export const maxDuration = 60;
// The sweep gets what is left of 50 s, so the function always returns before the 60 s limit.
const SWEEP_UNTIL_MS = 50_000;

export async function GET(req: Request) {
  const startedAt = Date.now();
  if (!isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) return new Response('unauthorized', { status: 401 });
  // Cleanup and demo seeding must never block the Soul write.
  const cleanup = await cleanupExpired().catch((e: Error) => ({ error: e.message }));
  const demoId = Number(process.env.DEMO_TOKEN_ID);
  const demo = demoId ? await seedDemoActivity(demoId).then((inserted) => ({ tokenId: demoId, inserted })).catch((e: Error) => ({ error: e.message })) : null;
  const soul = await runSoulJob().catch((e: Error) => ({ error: e.message }));
  const focus = process.env.FOCUS_POOL ? await sweepExpiredBets(Date.now(), undefined, Math.max(0, SWEEP_UNTIL_MS - (Date.now() - startedAt))).catch((e: Error) => ({ error: e.message })) : null;
  return Response.json({ ...soul, cleanup, demo, focus });
}
