// Mock switch. NEXT_PUBLIC_ variables are exposed to the browser at build time.
// Set NEXT_PUBLIC_MOCK=1 on Vercel to run the site with mock data and no backend.
export const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";
