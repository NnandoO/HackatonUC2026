type CoreApiOptions = RequestInit & { admin?: boolean };

export async function coreApiFetch(path: string, options: CoreApiOptions = {}) {
  const baseUrl = (process.env.ANGIBELL_API_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
  const headers = new Headers(options.headers);
  if (options.admin) {
    const key = process.env.ANGIBELL_ADMIN_SERVICE_KEY;
    if (!key) throw new Error("Falta ANGIBELL_ADMIN_SERVICE_KEY en el servidor web.");
    headers.set("X-Angibell-Admin-Key", key);
  }
  headers.set("Accept", "application/json");
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });
}
