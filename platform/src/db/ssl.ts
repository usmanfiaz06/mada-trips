// How to reach the database over TLS. Local databases don't use it. Remote ones (Supabase) always do; set DATABASE_CA
// to the provider's CA certificate (PEM) to also verify the server's identity, which stops a man-in-the-middle.
export function sslFor(url: string) {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return false as const;
  const ca = process.env.DATABASE_CA?.replace(/\\n/g, "\n");
  return ca ? { ca, rejectUnauthorized: true } : ("require" as const);
}
