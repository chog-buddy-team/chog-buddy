export async function fetchGithubUnread(token: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    // ponytail: first page only, so the count caps at 50 unread. Upgrade path: follow the Link header.
    const res = await fetchImpl('https://api.github.com/notifications?per_page=50', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'chog-buddy' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const v = await res.json();
    return Array.isArray(v) ? v.length : null;
  } catch {
    return null;
  }
}

export const githubShouldFire = (prev: number | null, next: number | null) => prev !== null && next !== null && next > prev;
