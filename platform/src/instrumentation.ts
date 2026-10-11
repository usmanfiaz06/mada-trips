// Runs once when a server instance starts (Next.js instrumentation). Logs which flight-status vendor is in use,
// so the deploy log says "[flight-status] using aerodatabox (its key is set)" without anyone having to ask.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { flightStatusVendor } = await import("./lib/app/suppliers/flight-status-vendor");
    flightStatusVendor();
  } catch {
    // Never stop a server from starting over a log line.
  }
}
