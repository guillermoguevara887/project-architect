import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

const requestHeadersToRemove = [
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
];

const responseHeadersToRemove = [
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
];

function buildTargetUrl(request: NextRequest, path: string[]) {
  const target = new URL(
    process.env.API_INTERNAL_URL ?? "http://localhost:4000",
  );
  const basePath = target.pathname.replace(/\/$/, "");
  const encodedPath = path.map(encodeURIComponent).join("/");

  target.pathname = `${basePath}/${encodedPath}`;
  target.search = request.nextUrl.search;

  return target;
}

async function proxyRequest(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const headers = new Headers(request.headers);

  for (const name of requestHeadersToRemove) {
    headers.delete(name);
  }

  headers.set("x-forwarded-host", request.nextUrl.host);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : await request.arrayBuffer();

  try {
    const upstreamResponse = await fetch(buildTargetUrl(request, path), {
      body,
      cache: "no-store",
      headers,
      method,
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstreamResponse.headers);

    for (const name of responseHeadersToRemove) {
      responseHeaders.delete(name);
    }

    return new Response(upstreamResponse.body, {
      headers: responseHeaders,
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
    });
  } catch (error) {
    console.error("MemoOS API proxy failed", error);

    return Response.json(
      { error: "API_UNAVAILABLE" },
      { status: 502 },
    );
  }
}

export {
  proxyRequest as DELETE,
  proxyRequest as GET,
  proxyRequest as HEAD,
  proxyRequest as OPTIONS,
  proxyRequest as PATCH,
  proxyRequest as POST,
  proxyRequest as PUT,
};
