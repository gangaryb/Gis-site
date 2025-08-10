// src/api.js
import { API_BASE } from "./config.js";

async function http(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} :: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

export const api = {
  health: () => http("/health").catch(() => "DOWN"),
  predict: (input) => http("/api/v1/predict", { method: "POST", body: JSON.stringify({ input }) }),
  contact: (payload) => http("/api/v1/contact", { method: "POST", body: JSON.stringify(payload) }),
  order: (payload) => http("/api/v1/order", { method: "POST", body: JSON.stringify(payload) }),
};