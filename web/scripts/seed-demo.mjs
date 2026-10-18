#!/usr/bin/env node
/**
 * Script de carga de catálogo hacia la API unificada (PostgreSQL).
 * Los datos mock anteriores fueron eliminados; agrega productos reales en CATALOGO si deseas sembrar por script.
 * Uso: node scripts/seed-demo.mjs [http://localhost:3000]
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function envLocal(key) {
  for (const file of [".env.local", ".env"]) {
    try {
      const txt = readFileSync(path.join(ROOT, file), "utf8");
      const line = txt.split("\n").find((l) => l.startsWith(`${key}=`));
      if (line) return line.slice(key.length + 1).trim();
    } catch {
      // Intentar el siguiente archivo de entorno.
    }
  }
  return null;
}

const API_KEY = process.env.PAPERCLIP_API_KEY ?? envLocal("PAPERCLIP_API_KEY");
const CATALOGO = [];

if (CATALOGO.length === 0) {
  console.log("Sin datos mock para sembrar (catálogo limpio en PostgreSQL).");
  process.exit(0);
}

if (!API_KEY) {
  console.error("Falta PAPERCLIP_API_KEY (entorno o .env.local)");
  process.exit(1);
}

async function post(producto) {
  const [name, priceCents, compareAtCents, category, sizes, pending, description] = producto;
  const body = {
    name,
    description,
    price_cents: priceCents,
    category,
    sizes: sizes.map(([size, stock]) => ({ size, stock })),
    publish: !pending,
  };
  if (compareAtCents !== null) body.compare_at_cents = compareAtCents;
  const res = await fetch(`${BASE}/api/publications`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`ERROR ${name}: ${j.error ?? res.status}`);
    return null;
  }
  return j.estado;
}

let publicados = 0;
let pendientes = 0;
for (const producto of CATALOGO) {
  const estado = await post(producto);
  if (estado === "publicado") publicados += 1;
  else if (estado === "pendiente") pendientes += 1;
}

console.log(`Listo: ${publicados} publicados, ${pendientes} pendientes de aprobación.`);
