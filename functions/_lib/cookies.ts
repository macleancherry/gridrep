export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
  maxAge?: number; // seconds
};

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  header.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(rest.join("=") || "");
  });
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: CookieOptions = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push(`Path=${opts.path ?? "/"}`);

  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);

  return parts.join("; ");
}

export function clearCookie(name: string): string {
  return serializeCookie(name, "", { maxAge: 0, path: "/", httpOnly: true, secure: true, sameSite: "Lax" });
}
