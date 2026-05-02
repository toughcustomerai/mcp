// /auth/signin — Supabase sign-in.
//
// Three sign-in paths (handler picks based on the form fields submitted):
//
//   1. email + password   → signInWithPassword (no PKCE, no email round-trip;
//                            most reliable for testing).
//   2. email only         → signInWithOtp magic link (requires email click;
//                            fragile when the user clicks from another browser).
//   3. (no email)         → Google OAuth (requires provider enabled in
//                            Supabase Auth → Sign In / Providers).
//
// All redirects use HTTP 303 so browsers downgrade method to GET on the
// next hop (Supabase's /authorize requires GET; 307 would preserve POST
// and yield 405). The `next` URL is preserved end-to-end.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseSSRClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const PAGE_STYLE = `
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #f5f6f8; color: #111;
  }
  .shell { width: 100%; max-width: 400px; padding: 2.5rem 1rem; }
  .brand { text-align: center; margin-bottom: 1.75rem; }
  .brand h1 { font-size: 1.35rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  .brand p  { font-size: .9rem; color: #666; margin: 0; }
  .card {
    background: white; border: 1px solid #e3e6ea; border-radius: 10px;
    padding: 1.5rem; box-shadow: 0 1px 2px rgba(0,0,0,.04);
  }
  .card h2 { font-size: 1rem; margin: 0 0 .9rem; }
  form { display: flex; flex-direction: column; gap: .5rem; }
  label { font-size: .8rem; color: #444; margin-top: .25rem; }
  input {
    padding: .6rem .75rem; font-size: 1rem; border: 1px solid #cbd0d6;
    border-radius: 6px; background: white;
  }
  input:focus { outline: 2px solid #2563eb33; border-color: #2563eb; }
  .btn {
    padding: .65rem 1rem; border-radius: 6px; cursor: pointer;
    font-size: .95rem; font-weight: 500;
    border: 1px solid #2563eb; background: #2563eb; color: white;
  }
  .btn:hover { background: #1e4fc7; }
  .btn-secondary {
    background: white; color: #1f2937; border-color: #cbd0d6;
  }
  .btn-secondary:hover { background: #f5f6f8; }
  .divider {
    text-align: center; color: #888; font-size: .8rem;
    margin: 1.25rem 0 .75rem; position: relative;
  }
  .divider::before, .divider::after {
    content: ""; position: absolute; top: 50%; width: 38%;
    height: 1px; background: #e3e6ea;
  }
  .divider::before { left: 0; }
  .divider::after { right: 0; }
  .footer-note {
    text-align: center; font-size: .8rem; color: #6b7280;
    margin-top: 1.25rem;
  }
  .error {
    background: #fff1f2; border: 1px solid #fecaca; color: #991b1b;
    border-radius: 6px; padding: .6rem .8rem; margin-bottom: 1rem;
    font-size: .9rem;
  }
  .lock { color: #6b7280; }
`;

function brandHeader(): string {
  return `<div class="brand">
    <h1>Tough Customer</h1>
    <p>Sign in to continue</p>
  </div>`;
}

function signinForm(next: string, message?: string): string {
  return `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in — Tough Customer</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="shell">
    ${brandHeader()}
    <div class="card">
      ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}

      <form method="POST" action="/auth/signin">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <label for="email">Email</label>
        <input id="email" type="email" name="email" required autocomplete="email" autofocus>
        <label for="password">Password</label>
        <input id="password" type="password" name="password" required minlength="6" autocomplete="current-password">
        <button type="submit" class="btn" style="margin-top:.75rem">Sign in</button>
      </form>

      <div class="divider">or</div>

      <form method="POST" action="/auth/signin" style="margin-bottom:.5rem">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input type="email" name="email" required autocomplete="email" placeholder="Email a one-time link to…">
        <button type="submit" name="mode" value="magic" class="btn btn-secondary">
          Email me a sign-in link
        </button>
      </form>

      <form method="POST" action="/auth/signin">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <button type="submit" name="mode" value="google" class="btn btn-secondary">
          Continue with Google
        </button>
      </form>
    </div>
    <p class="footer-note">
      <span class="lock">🔒</span> Your credentials are transmitted over TLS and never stored on this server.
    </p>
  </div>
</body></html>`;
}

function magicLinkSentPage(email: string): string {
  return `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Check your email — Tough Customer</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="shell">
    ${brandHeader()}
    <div class="card" style="text-align:center">
      <h2>Check your email</h2>
      <p style="color:#444;margin:.25rem 0 0">
        We sent a sign-in link to <strong>${escapeHtml(email)}</strong>.
      </p>
      <p style="color:#6b7280;font-size:.85rem;margin:1rem 0 0">
        The link is valid for a few minutes and can only be used once.
        You can close this tab — clicking the link will bring you back.
      </p>
    </div>
  </div>
</body></html>`;
}

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") || "/connect";
  return htmlResponse(signinForm(next));
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const email = formData.get("email");
  const password = formData.get("password");
  const mode = formData.get("mode");
  const formNext = formData.get("next");
  const queryNext = req.nextUrl.searchParams.get("next");
  const next =
    (typeof formNext === "string" && formNext) ||
    queryNext ||
    "/connect";

  const callbackUrl = new URL("/auth/callback", appBaseUrl());
  callbackUrl.searchParams.set("next", next);

  const supabase = await getSupabaseSSRClient();

  // Path 1: email + password
  if (
    typeof email === "string" && email.length > 0 &&
    typeof password === "string" && password.length > 0
  ) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Generic message — never echo provider error text (could leak account
      // existence info or internal product names).
      return htmlResponse(
        signinForm(next, "Email or password didn't match. Please try again."),
        400,
      );
    }
    // Session cookies are now set. 303 forces GET on the next hop.
    return NextResponse.redirect(new URL(next, appBaseUrl()), 303);
  }

  // Path 2: magic link (email only, no password, OR explicit mode=magic)
  if (
    typeof email === "string" && email.length > 0 &&
    (mode === "magic" || !password)
  ) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl.toString() },
    });
    if (error) {
      return htmlResponse(
        signinForm(next, "We couldn't send the sign-in link. Try again in a moment."),
        400,
      );
    }
    return htmlResponse(magicLinkSentPage(email));
  }

  // Path 3: Google OAuth
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl.toString() },
  });
  if (error || !data.url) {
    return htmlResponse(
      signinForm(next, "Google sign-in is currently unavailable. Try email instead."),
      400,
    );
  }
  return NextResponse.redirect(data.url, 303);
}
