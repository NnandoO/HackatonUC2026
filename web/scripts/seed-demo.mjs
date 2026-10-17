#!/usr/bin/env node
/**
 * Siembra el catálogo real de Angibell (lista 2026) usando la misma API
 * que usa Paperclip. Borra los productos anteriores y vuelve a cargar.
 * Uso: node scripts/seed-demo.mjs [http://localhost:3000]
 * Requiere PAPERCLIP_API_KEY en el entorno o en .env.local
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function envLocal(key) {
  try {
    const txt = readFileSync(path.join(ROOT, ".env.local"), "utf8");
    const line = txt.split("\n").find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : null;
  } catch {
    return null;
  }
}

const API_KEY = process.env.PAPERCLIP_API_KEY ?? envLocal("PAPERCLIP_API_KEY");
if (!API_KEY) {
  console.error("Falta PAPERCLIP_API_KEY (entorno o .env.local)");
  process.exit(1);
}

const NINOS = "Ropa Para Niños";
const NINAS = "Ropa Para Niñas";
const VESP = "Vestidos Especiales / Vestidos 3 en 1";
const VNIN = "Vestidos de Niñas (2-14 años)";
const TERN = "Ternos Para Niños (0-16 años)";
const BEBE = "Ropa Para Bebés";

// [nombre, precio ¢, antes ¢ | null, categoría, tallas [talla, stock], pendiente?, descripción]
const CATALOGO = [
  ["Casaca taslán con forro", 9500, 11700, NINOS, [["2", 3], ["4", 2], ["6", 0], ["8", 4], ["10", 1], ["12", 2], ["14", 3]], false, ""],
  ["Camisa a rayas manga larga", 6500, 7700, NINOS, [["2", 2], ["4", 3], ["6", 2], ["8", 2], ["10", 3], ["12", 2], ["14", 1]], false, ""],
  ["Casaca jean manga franela", 10000, null, NINOS, [["4", 2], ["6", 3], ["8", 2], ["10", 2], ["12", 1]], false, "Precio aproximado en catálogo."],
  ["Polera over franela niño", 8000, 9500, NINOS, [["2", 2], ["4", 2], ["6", 3], ["8", 2], ["10", 2], ["12", 2]], false, ""],
  ["Pantalón dril semi pitillo", 8000, 8800, NINOS, [["2", 4], ["4", 3], ["6", 2], ["8", 3], ["10", 2], ["12", 1], ["14", 2]], false, ""],
  ["Casaca taslán con forro doble", 12500, 14000, NINOS, [["2", 2], ["4", 2], ["6", 2], ["8", 2], ["10", 1], ["12", 1]], false, ""],
  ["Casaca franela niño", 8000, 10100, NINOS, [["2", 3], ["4", 2], ["6", 4], ["8", 2], ["10", 2], ["12", 2], ["14", 1]], false, ""],
  ["Camisaco drill con forro", 10000, 10800, NINOS, [["4", 2], ["6", 2], ["8", 3], ["10", 2], ["12", 2]], false, ""],
  ["Camisaco corduroy con forro", 8000, 8800, NINOS, [["2", 2], ["4", 3], ["6", 2], ["8", 2], ["10", 2], ["12", 1]], false, ""],
  ["Camisaco jean con forro", 10000, 11800, NINOS, [["2", 1], ["4", 2], ["6", 2], ["8", 2], ["10", 2], ["12", 2], ["14", 1]], false, ""],
  ["Casaca taslán cortaviento", 9000, 11000, NINOS, [["2", 3], ["4", 2], ["6", 2], ["8", 3], ["10", 2], ["12", 2]], false, ""],
  ["Pantalón jean semi pitillo", 8500, 9500, NINOS, [["4", 3], ["6", 2], ["8", 3], ["10", 2], ["12", 2], ["14", 1]], false, ""],
  ["Camisa manga larga", 6500, null, NINOS, [["2", 2], ["4", 3], ["6", 3], ["8", 2], ["10", 2], ["12", 1], ["14", 2]], false, ""],
  ["Casaca taslán con forro niño", 9500, null, NINOS, [["4", 2], ["6", 2], ["8", 2], ["10", 2], ["12", 1], ["14", 1]], false, ""],
  ["Pantalón niño con forro", 8000, null, NINOS, [["2", 3], ["4", 2], ["6", 2], ["8", 2], ["10", 2], ["12", 2], ["14", 1]], false, ""],

  ["Pantalón dril niña con forro", 6500, 6800, NINAS, [["4", 3], ["6", 2], ["8", 3], ["10", 2], ["12", 2], ["14", 2]], false, ""],
  ["Pantalón palazo niña", 8000, 9700, NINAS, [["6", 2], ["8", 3], ["10", 2], ["12", 2], ["14", 1]], false, ""],
  ["Conjunto jean para niñas", 12000, 14300, NINAS, [["4", 2], ["6", 3], ["8", 2], ["10", 2], ["12", 2], ["14", 2]], false, ""],
  ["Campera dril con forro peluche", 12500, 15300, NINAS, [["4", 2], ["6", 2], ["8", 2], ["10", 2], ["12", 1], ["14", 1]], false, ""],

  ["Vestido Damita de Honor", 100, null, VESP, [["4", 1], ["6", 1], ["8", 2], ["10", 1], ["12", 1]], false, "Línea Damita Honor Andina · edición especial."],
  ["Vestido Huntrix Niña", 15000, 16000, VESP, [["4", 2], ["6", 2], ["8", 1], ["10", 1]], true, "Vestido 3 en 1."],
  ["Vestido Blanco Damita", 15000, 16000, VESP, [["4", 2], ["6", 2], ["8", 2], ["10", 1], ["12", 1]], false, "Vestido 3 en 1."],
  ["Vestido Ensueño 2 en 1", 10000, 10900, VESP, [["2", 1], ["4", 2], ["6", 2], ["8", 2], ["10", 1]], false, "Set de tres piezas."],
  ["Vestido Perla con Dorado", 20000, 22900, VESP, [["4", 1], ["6", 2], ["8", 2], ["10", 1], ["12", 1]], false, "Precio varía según talla."],
  ["Vestido Rosas", 20000, 21900, VESP, [["2", 2], ["4", 2], ["6", 2], ["8", 1], ["10", 2], ["12", 1]], false, "Color rosado · set de dos piezas."],
  ["Vestido Azulino", 13000, 14900, VESP, [["2", 2], ["4", 3], ["6", 2], ["8", 2], ["10", 1]], false, "Set de dos piezas: vestido y bolero."],

  ["Vestido Blanco", 12500, 14900, VNIN, [["2", 2], ["4", 2], ["6", 3], ["8", 2], ["10", 2], ["12", 1], ["14", 1]], false, "Set de dos piezas: vestido y bolero."],
  ["Vestido Blanco Hojitas", 12000, 13500, VNIN, [["2", 3], ["4", 2], ["6", 2], ["8", 2], ["10", 1], ["12", 1], ["14", 1]], false, "Set de dos piezas: vestido y bolero."],
  ["Vestido Blanco Organza", 11000, 12900, VNIN, [["2", 2], ["4", 2], ["6", 2], ["8", 2], ["10", 2], ["12", 1]], false, "Set de dos piezas."],
  ["Vestido Mariposa Agua Marina", 12000, 13900, VNIN, [["2", 2], ["4", 2], ["6", 2], ["8", 1], ["10", 2], ["12", 1]], false, "Set de dos piezas: vestido y bolero."],
  ["Vestido Mariposas", 12000, 13900, VNIN, [["2", 2], ["4", 3], ["6", 2], ["8", 2], ["10", 1], ["12", 1]], false, "Set de dos piezas: vestido y bolero."],

  ["Terno Niño Bautizo", 21500, 22500, TERN, [["0", 1], ["2", 2], ["4", 2], ["6", 2], ["8", 1], ["10", 1]], false, ""],
  ["Terno Niño Bautizo primera comunión", 25000, 26500, TERN, [["2", 2], ["4", 2], ["6", 1], ["8", 2], ["10", 1]], false, ""],
  ["Terno para Bautizo y Promoción", 23000, 24500, TERN, [["0", 1], ["2", 2], ["4", 2], ["6", 2], ["8", 2]], false, "Set de 5 piezas."],
  ["Terno Niño Matrimonio", 24500, 25500, TERN, [["2", 1], ["4", 2], ["6", 2], ["8", 2], ["10", 1], ["12", 1]], false, ""],
  ["Terno para Promoción", 23000, 24500, TERN, [["2", 2], ["4", 2], ["6", 2], ["8", 1]], true, "Set de 5 piezas."],
  ["Terno Niño Promoción", 24500, 26000, TERN, [["2", 2], ["4", 2], ["6", 2], ["8", 1], ["10", 2], ["12", 1]], false, ""],

  ["Ropón de hilo tacto fino", 9000, 9500, BEBE, [["RN", 2], ["3", 3], ["6", 2], ["9", 1], ["12", 1]], false, "Set de 4 piezas."],
  ["Ropón de hilo tacto clásico", 8500, 9000, BEBE, [["RN", 2], ["3", 2], ["6", 2], ["9", 2], ["12", 1]], false, "Set de 3 piezas."],
  ["Overol de hilo tacto", 9500, 9900, BEBE, [["RN", 1], ["3", 2], ["6", 2], ["9", 2], ["12", 1]], false, "Set de 4 piezas."],
  ["Polo cuello bebé", 4000, 4300, BEBE, [["3", 3], ["6", 3], ["9", 2], ["12", 2]], false, "Blanco con filo de color."],
  ["Ajuar RN Plus nacional", 7500, 7800, BEBE, [["RN", 2], ["3", 3], ["6", 2], ["9", 1]], false, "Set de 5 piezas."],
  ["Colcha de hilo tacto con forro", 9500, 9900, BEBE, [["Única", 3]], false, "Colores: blanco, perla, rosado."],
  ["Ajuar 5 piezas clásico RN", 6500, 6800, BEBE, [["RN", 3], ["3", 2], ["6", 2], ["9", 1]], false, ""],
  ["Polo de algodón pima", 3000, 3800, BEBE, [["RN", 3], ["3", 4], ["6", 3], ["9", 2], ["12", 2]], false, "Manga larga."],
];

function resetDb() {
  const dataDir = process.env.DATA_DIR ?? path.join(ROOT, "data");
  const db = new DatabaseSync(path.join(dataDir, "angibell.db"));
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("DELETE FROM publications; DELETE FROM variants; DELETE FROM products;");
  db.close();
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

console.log(`Re-sembrando catálogo real en ${BASE} (${CATALOGO.length} productos)...`);
resetDb();

let publicados = 0;
let pendientes = 0;
for (const producto of CATALOGO) {
  const estado = await post(producto);
  if (estado === "publicado") publicados += 1;
  else if (estado === "pendiente") pendientes += 1;
}

console.log(`Listo: ${publicados} publicados, ${pendientes} pendientes de aprobación.`);
