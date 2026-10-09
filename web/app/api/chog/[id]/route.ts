import { ARCHETYPES, fetchChogMetadata, ipfsToHttp, pickArchetype } from '@chog/core';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tokenId = Number((await params).id);
  try {
    const meta = await fetchChogMetadata(tokenId);
    const archetype = pickArchetype(meta);
    return Response.json(
      { ...meta, image: ipfsToHttp(meta.image), archetype, archetypeName: ARCHETYPES[archetype].name },
      { headers: { 'cache-control': 'public, s-maxage=86400' } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof RangeError ? 400 : 502 });
  }
}
