const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function token() { return typeof window === "undefined" ? "" : localStorage.getItem("sle_token") || ""; }
export function setToken(value: string) { localStorage.setItem("sle_token", value); }
export function clearToken() { localStorage.removeItem("sle_token"); }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token()) headers.set("Authorization", `Bearer ${token()}`);
  const response = await fetch(`${API}${path}`, { ...options, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : body.detail?.message || "Ошибка запроса");
  return body as T;
}
