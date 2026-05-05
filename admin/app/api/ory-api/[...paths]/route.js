import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  return handleProxy(request, params);
}

export async function POST(request, { params }) {
  return handleProxy(request, params);
}

export async function PUT(request, { params }) {
  return handleProxy(request, params);
}

export async function PATCH(request, { params }) {
  return handleProxy(request, params);
}

export async function DELETE(request, { params }) {
  return handleProxy(request, params);
}

const PROXY_BASE = "/api/ory-api";

const UPSTREAM_FETCH_TIMEOUT_MS = 30_000;

/**
 * Server-only Ory URL (prefer ORY_SDK_URL so the tenant is not in the client bundle).
 * Dev fallback restores local login when env is not configured; production requires env.
 */
function resolveOrySdkUrl() {
  const fromEnv = process.env.ORY_SDK_URL || process.env.NEXT_PUBLIC_ORY_SDK_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") {
    return "https://suspicious-agnesi-frtp7mro6t.projects.oryapis.com";
  }
  return null;
}

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-charset",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-type",
  "cookie",
  "user-agent",
];

// Ory sets cookies with Domain=<project>.projects.oryapis.com. The browser will
// refuse to store those because the page is on localhost, which is why the CSRF
// cookie goes missing and submission calls come back with a 403. Strip the
// Domain attribute so the cookies are stored as host-only for the current origin.
function rewriteSetCookie(cookieHeader) {
  return cookieHeader.replace(/;\s*Domain=[^;]+/i, "");
}

function canIncludeBody(method, status) {
  if (method === "HEAD") return false;
  return status !== 204 && status !== 205 && status !== 304;
}

function isTextLikeContentType(contentType = "") {
  const lower = contentType.toLowerCase();
  return (
    lower.startsWith("text/") ||
    lower.includes("application/json") ||
    lower.includes("application/javascript") ||
    lower.includes("application/xml") ||
    lower.includes("application/x-www-form-urlencoded")
  );
}

async function handleProxy(request, params) {
  const { paths } = await params;
  const path = paths.join("/");
  const sdkUrl = resolveOrySdkUrl();
  if (!sdkUrl) {
    return NextResponse.json(
      { error: "Authentication service is not configured. Set ORY_SDK_URL or NEXT_PUBLIC_ORY_SDK_URL." },
      { status: 500 }
    );
  }
  const url = `${sdkUrl}/${path}${request.nextUrl.search}`;

  const requestHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARDED_REQUEST_HEADERS.includes(key.toLowerCase())) {
      requestHeaders.set(key, value);
    }
  });
  requestHeaders.set("host", new URL(sdkUrl).host);
  requestHeaders.set("X-Ory-Base-URL-Rewrite", "false");
  requestHeaders.set("Ory-Base-URL-Rewrite", "false");
  requestHeaders.set("Ory-No-Custom-Domain-Redirect", "true");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: request.method,
      headers: requestHeaders,
      body: request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k === "content-encoding" || k === "transfer-encoding" || k === "content-length" || k === "set-cookie") {
        return;
      }
      responseHeaders.append(key, value);
    });

    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    setCookies.forEach((cookie) => {
      responseHeaders.append("set-cookie", rewriteSetCookie(cookie));
    });

    const location = response.headers.get("location");
    if (location) {
      // [Open Redirect] Forward only trusted Ory/relative redirects, never arbitrary upstream Location values.
      if (location.startsWith(sdkUrl)) {
        responseHeaders.set("location", location.replace(sdkUrl, PROXY_BASE));
      } else if (location.startsWith("/self-service/") || location.startsWith("/ui/")) {
        responseHeaders.set("location", PROXY_BASE + location);
      }
    }

    const shouldIncludeBody = canIncludeBody(request.method, response.status);
    let body = null;
    if (shouldIncludeBody) {
      const buf = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      if (isTextLikeContentType(contentType)) {
        body = buf.toString("utf-8").replaceAll(sdkUrl, PROXY_BASE);
      } else {
        body = buf;
      }
    }

    return new NextResponse(shouldIncludeBody ? body : null, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("Admin Ory Proxy Error");
    }
    const status = error?.name === "AbortError" ? 504 : 500;
    const message =
      error?.name === "AbortError" ? "Authentication service timed out." : "Authentication proxy error.";
    return NextResponse.json({ error: message }, { status });
  } finally {
    clearTimeout(timeoutId);
  }
}
