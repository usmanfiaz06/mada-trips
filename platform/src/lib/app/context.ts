import "server-only";
import { clientIp, ipHash, userAgent } from "./http";

/** Request facts every handler records: IP (hashed for storage), user agent. */
export function requestContext(req: Request) {
  const ip = clientIp(req);
  return { ip, ipHash: ipHash(ip), userAgent: userAgent(req) };
}
