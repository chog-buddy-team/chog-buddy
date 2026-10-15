export const DEFAULT_API_URL = 'https://chog-buddy-api.vercel.app';
export const apiUrl = () => process.env.CHOG_API_URL ?? DEFAULT_API_URL;
// The Focus Bets page lives on the new domain; API calls still go through apiUrl().
export const FOCUS_SITE = 'https://chogbuddy.vercel.app';
