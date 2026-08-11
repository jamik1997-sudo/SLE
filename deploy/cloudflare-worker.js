const FRONTEND_ORIGIN = "https://sle-xi.vercel.app";
const ORIGIN = "http://129.225.120.100";

function corsHeaders(request) {
  const requested = request.headers.get("Access-Control-Request-Headers");
  return {
    "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": requested || "Authorization,Content-Type,X-Device-ID",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
  };
}

export default {
  async fetch(request) {
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const incomingUrl = new URL(request.url);
      const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, ORIGIN);
      const headers = new Headers(request.headers);
      // Host выставит fetch сам. Явная подмена иногда ломает проксирование.
      headers.delete("host");

      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "follow",
      });

      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) responseHeaders.set(key, value);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response(JSON.stringify({
        detail: "Сервер временно недоступен. Повторите попытку через несколько секунд."
      }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      });
    }
  },
};
