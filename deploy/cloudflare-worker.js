const FRONTEND_ORIGIN = "https://sle-xi.vercel.app";
const ORIGIN = "https://sle-audit.duckdns.org";

function corsHeaders(request) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowOrigin = requestOrigin === FRONTEND_ORIGIN ? FRONTEND_ORIGIN : FRONTEND_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Device-ID",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
  };
}

export default {
  async fetch(request) {
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors,
      });
    }

    try {
      const incoming = new URL(request.url);
      const target = new URL(incoming.pathname + incoming.search, ORIGIN);

      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("cf-connecting-ip");
      headers.delete("cf-ray");
      headers.delete("cf-visitor");

      const init = {
        method: request.method,
        headers,
        redirect: "follow",
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
      }

      const response = await fetch(target.toString(), init);
      const responseHeaders = new Headers(response.headers);

      for (const [key, value] of Object.entries(cors)) {
        responseHeaders.set(key, value);
      }

      responseHeaders.set("Cache-Control", "no-store");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          detail: "Backend temporarily unavailable",
          error: String(error?.message || error),
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...cors,
          },
        }
      );
    }
  },
};
