import type { Product } from "./db";

export type PublicVariant = {
  id: string;
  size: string;
  color: string;
  stock: number;
  stockFuente: "declarado";
  stockDeclarado: number;
};

export type PublicProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
  category: string;
  colors: string[];
  images: string[];
  status: string;
  createdAt: string;
  variants: PublicVariant[];
  totalStock: number;
  agotado: boolean;
};

export function toPublicProduct(p: Product): PublicProduct {
  const variants: PublicVariant[] = p.variants.map((v) => ({
    id: v.id,
    size: v.size,
    color: v.color,
    stock: v.stockDeclared,
    stockFuente: "declarado",
    stockDeclarado: v.stockDeclared,
  }));
  const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    compareAtCents: p.compareAtCents,
    currency: p.currency,
    category: p.category,
    colors: p.colors,
    images: p.imageUrls,
    status: p.status,
    createdAt: p.createdAt,
    variants,
    totalStock,
    agotado: totalStock <= 0,
  };
}

export function formatPrecio(cents: number, currency = "PEN"): string {
  const valor = cents / 100;
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency,
    minimumFractionDigits: valor % 1 === 0 ? 0 : 2,
  }).format(valor);
}
