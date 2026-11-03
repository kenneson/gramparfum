import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isLogin = request.nextUrl.pathname.startsWith("/login");

  if (!data?.claims && !isLogin) {
    return withSession(response, NextResponse.redirect(new URL("/login", request.url)));
  }
  if (data?.claims && isLogin) {
    return withSession(response, NextResponse.redirect(new URL("/caixa", request.url)));
  }
  return response;
}

// Redirect precisa levar os cookies renovados, senão o usuário é deslogado
function withSession(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((c) => to.cookies.set(c));
  for (const h of ["cache-control", "expires", "pragma"]) {
    const v = from.headers.get(h);
    if (v) to.headers.set(h, v);
  }
  return to;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.png|.*\.(?:png|jpg|svg|ico)$).*)"],
};
