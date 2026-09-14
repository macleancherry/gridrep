const MAX_BYTES = 5 * 1024 * 1024;

export async function onRequestPost(context: any) {
  const { request, env } = context;

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return Response.json({ error: "Expected an image body." }, { status: 400 });
  }

  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) {
    return Response.json({ error: "Empty image." }, { status: 400 });
  }
  if (buf.byteLength > MAX_BYTES) {
    return Response.json({ error: "Image too large (5MB max)." }, { status: 413 });
  }

  if (!env.AI) {
    return Response.json({ error: "Image reading isn't configured on this deployment yet." }, { status: 503 });
  }

  try {
    const result: any = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      image: Array.from(new Uint8Array(buf)),
      prompt:
        "This is a screenshot, likely of a chat message or a question someone typed. " +
        "Reply with ONLY the question or statement being asked in the image, verbatim if possible. " +
        "No preamble, no quotes, no explanation. If there's no clear question, reply with the single most prominent line of text in the image.",
      max_tokens: 120,
    });

    const text = String(result?.response ?? "").trim();
    if (!text) {
      return Response.json({ error: "Couldn't make out any text in that image." }, { status: 422 });
    }

    return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return Response.json({ error: "Joel squinted at it and gave up. Try again?" }, { status: 500 });
  }
}
