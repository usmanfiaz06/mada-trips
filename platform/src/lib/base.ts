// Mada Ops lives at /adminwork on the same domain as the public website (the app's routes are in
// src/app/adminwork). Use withBase() for raw asset URLs and cookie paths.
export const BASE = "/adminwork";
export const withBase = (path: string) => `${BASE}${path}`;
