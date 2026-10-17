import type { Product, ProductInput, Page } from '@angibell/contracts';
export declare class CatalogService {
    getProducts(options: {
        limit?: number;
        cursor?: string | null;
    }): Page<Product>;
    getProductById(id: string): Product | null;
    adminGetProducts(options: {
        limit?: number;
        cursor?: string | null;
    }): Page<Product>;
    createProduct(input: ProductInput, actorId: string): Product;
    private mapProduct;
}
export declare const catalogService: CatalogService;
