import { fetchChogMetadata, pickArchetype } from '@chog/core';
import { bumpChatUsage, callerKey, chatCaps } from '@/lib/caps';
import { generateChat, parseChatBody } from '@/lib/chat';
import { requireSession } from '@/lib/session';

// No sign-in required so Judge Mode can chat. Daily caps protect the shared Gemini quota;
// past a cap the Chog still answers, in character, without Gemini. Chat text is never stored.
export async function POST(req: Request) {
  let body;
  try {
    body = parseChatBody(await req.json());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const wallet = req.headers.get('authorization') ? await requireSession(req).catch(() => null) : null;
  const caps = chatCaps();
  const [mine, everyone] = await Promise.all([bumpChatUsage(callerKey(req, wallet)), bumpChatUsage('global')]);
  let meta;
  try {
    meta = await fetchChogMetadata(body.tokenId);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  return Response.json(
    await generateChat(pickArchetype(meta), meta.name, body.messages, fetch, undefined, mine <= caps.perCaller && everyone <= caps.global),
  );
}
