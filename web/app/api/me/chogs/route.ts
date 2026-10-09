import { listOwnedChogs } from '@/lib/owner';
import { requireSession, unauthorized } from '@/lib/session';

export async function GET(req: Request) {
  let address;
  try {
    address = await requireSession(req);
  } catch (e) {
    return unauthorized(e);
  }
  return Response.json({ tokenIds: await listOwnedChogs(address) });
}
