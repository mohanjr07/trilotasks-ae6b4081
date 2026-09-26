// Cloudflare Pages Function: forwards /sb/* to Supabase.
// Some Indian ISPs (Jio, Airtel, ACT) block *.supabase.co, so the app talks to
// our own domain and Cloudflare relays the request. Handles REST, auth,
// storage, edge functions and realtime websockets.
const SUPABASE_ORIGIN = "https://jhtfhjfwjsutkwebmrgv.supabase.co";

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const target = new URL(url.pathname.replace(/^\/sb/, "") + url.search, SUPABASE_ORIGIN);

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;

  return fetch(target.toString(), init);
}
