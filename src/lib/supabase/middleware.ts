import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  // Require auth on /app and /cowork pages. API routes under those paths
  // handle their own auth (returning 401 JSON instead of redirecting), so
  // exclude /api/* from the redirect — otherwise headless callers using the
  // Authorization: Bearer COWORK_API_TOKEN flow would get HTML redirects.
  if (!user && !path.startsWith("/api") && (path.startsWith("/app") || path.startsWith("/cowork"))) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    return NextResponse.redirect(redirect);
  }

  if (user && (path === "/" || path === "/login")) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/app";
    return NextResponse.redirect(redirect);
  }

  return response;
}
