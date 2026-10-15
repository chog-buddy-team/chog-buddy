import { cleanupExpired } from '@/lib/cleanup';
import { isCronAuthorized } from '@/lib/cron-auth';
import { seedDemoActivity } from '@/lib/demo';
import { sweepExpiredBets } from '@/lib/focus-sweep';
import { runSoulJob } from '@/lib/soul-job';

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) return new Response('unauthorized', { status: 401 });
  // Cleanup and demo seeding must never block the Soul write.
  const cleanup = await cleanupExpired().catch((e: Error) => ({ error: e.message }));
  const demoId = Number(process.env.DEMO_TOKEN_ID);
  const demo = demoId ? await seedDemoActivity(demoId).then((inserted) => ({ tokenId: demoId, inserted })).catch((e: Error) => ({ error: e.message })) : null;
  // The Soul job and the Focus sweep use different wallets and run side by side, so a slow Soul job
  // can't eat the sweep's 30 s budget.
  const [soul, focus] = await Promise.all([
    runSoulJob().catch((e: Error) => ({ error: e.message })),
    process.env.FOCUS_POOL ? sweepExpiredBets().catch((e: Error) => ({ error: e.message })) : null,
  ]);
  return Response.json({ ...soul, cleanup, demo, focus });
}
