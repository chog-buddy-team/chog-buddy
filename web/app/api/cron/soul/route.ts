import { cleanupExpired } from '@/lib/cleanup';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runSoulJob } from '@/lib/soul-job';

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) return new Response('unauthorized', { status: 401 });
  // Cleanup must never block the Soul write.
  const cleanup = await cleanupExpired().catch((e: Error) => ({ error: e.message }));
  return Response.json({ ...(await runSoulJob()), cleanup });
}
