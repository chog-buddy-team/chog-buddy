export const CATEGORIES = ['coding', 'design', 'chat', 'browsing', 'video', 'meeting', 'idle', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Trait = { trait_type: string; value: string };
export type ChogMetadata = { tokenId: number; name: string; image: string; attributes: Trait[] };

export type ArchetypeId = 'hype' | 'grump' | 'lazySage' | 'chaos' | 'sweetheart';

export type Axes = { nightOwl: number; grinder: number; social: number; creator: number };
export type Soul = Axes & { level: number; ownerCount: number };

/** One day of Activity for the Active Chog. Minutes may be fractional while accumulating. */
export type DailyTotals = {
  minutes: Record<Category, number>;
  lateMinutes: number; // active (non-idle) minutes at 22:00-03:59 local
  earlyMinutes: number; // active minutes at 05:00-07:59 local
};
