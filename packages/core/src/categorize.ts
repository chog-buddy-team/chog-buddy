import type { Category } from './types';

export const IDLE_THRESHOLD_SEC = 120;

// Order matters: first match wins. Short names use \b so "arc" doesn't match "search".
const RULES: Array<[Category, RegExp]> = [
  ['meeting', /zoom|\bteams\b|google meet|meet\.google|webex|facetime|gather/i],
  ['coding', /\bcode\b|cursor|xcode|intellij|webstorm|pycharm|android studio|terminal|iterm|warp|ghostty|sublime|\bvim\b|\bzed\b|github|gitlab|stack ?overflow|localhost/i],
  ['design', /figma|sketch|photoshop|illustrator|affinity|blender|canva|procreate|framer/i],
  ['chat', /slack|discord|telegram|whatsapp|\bmessages\b|signal|messenger|wechat/i],
  ['video', /youtube|netflix|twitch|\bvlc\b|\biina\b|prime video|disney\+|tiktok|quicktime/i],
  ['browsing', /chrome|safari|firefox|\barc\b|brave|\bedge\b|opera|x\.com|twitter|reddit/i],
];

export function categorize(app: string, title = '', idleSec = 0): Category {
  if (idleSec >= IDLE_THRESHOLD_SEC) return 'idle';
  // Title first: "YouTube - Chrome" is video, not browsing.
  for (const [category, re] of RULES) if (title && re.test(title)) return category;
  for (const [category, re] of RULES) if (re.test(app)) return category;
  return 'other';
}
