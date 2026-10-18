import { setProductStatus, type Product } from "./db";

export type ApproveOutcome = {
  product: Product;
};

export async function approveProduct(productId: string): Promise<ApproveOutcome> {
  const product = await setProductStatus(productId, "publicado");
  return { product };
}

export async function rejectProduct(productId: string): Promise<Product> {
  return await setProductStatus(productId, "rechazado");
}
