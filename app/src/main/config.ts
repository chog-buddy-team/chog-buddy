export const DEFAULT_API_URL = 'https://chog-buddy-api.vercel.app';
export const apiUrl = () => process.env.CHOG_API_URL ?? DEFAULT_API_URL;
