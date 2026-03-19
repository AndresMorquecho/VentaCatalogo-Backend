import { CatalogInventory } from './CatalogInventory.entity';

export interface ICatalogInventoryRepository {
  findByBrandAndCampaign(brandId: string, campaign: string): Promise<CatalogInventory | null>;
  findMany(filters: {
    brandId?: string;
    campaign?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: CatalogInventory[]; total: number }>;
  save(inventory: CatalogInventory): Promise<CatalogInventory>;
  update(inventory: CatalogInventory): Promise<CatalogInventory>;
}
