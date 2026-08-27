function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Verifies Discord's Ed25519 request signature (X-Signature-Ed25519 /
 * X-Signature-Timestamp headers over `timestamp + body`), per
 * https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
 */
export async function verifyDiscordRequest(
  request: Request,
  publicKeyHex: string
): Promise<{ valid: boolean; body: string }> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const body = await request.text();

  if (!signature || !timestamp) {
    return { valid: false, body };
  }

  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body)
    );
    return { valid, body };
  } catch (err) {
    console.error("Signature verification error", err);
    return { valid: false, body };
  }
}
