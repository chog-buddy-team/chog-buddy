import { isCronAuthorized } from '@/lib/cron-auth';
import { runSoulJob } from '@/lib/soul-job';

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) return new Response('unauthorized', { status: 401 });
  return Response.json(await runSoulJob());
}
