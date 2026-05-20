import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function proxy(request: NextRequest) {
  const canonicalRedirect = getCanonicalHostRedirect(request);

  if (canonicalRedirect) {
    return canonicalRedirect;
  }

  if (!request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );

    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

function getCanonicalHostRedirect(request: NextRequest): NextResponse | null {
  if (process.env.VERCEL_ENV !== "production") {
    return null;
  }

  const canonicalOrigin = getCanonicalAppOrigin();

  if (!canonicalOrigin) {
    return null;
  }

  const currentUrl = request.nextUrl;

  if (
    currentUrl.protocol === canonicalOrigin.protocol &&
    currentUrl.host === canonicalOrigin.host
  ) {
    return null;
  }

  const redirectUrl = new URL(
    `${currentUrl.pathname}${currentUrl.search}`,
    canonicalOrigin,
  );

  return NextResponse.redirect(redirectUrl, 308);
}

function getCanonicalAppOrigin(): URL | null {
  const rawAppUrl =
    process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!rawAppUrl) {
    return null;
  }

  try {
    return new URL(rawAppUrl);
  } catch {
    return null;
  }
}
