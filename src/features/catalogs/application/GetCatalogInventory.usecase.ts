import { Result } from '../../../shared/domain/Result';
import { CatalogInventory } from '../domain/CatalogInventory.entity';
import { ICatalogInventoryRepository } from '../domain/ICatalogInventoryRepository';

export interface GetCatalogInventoryFilters {
  brandId?: string;
  campaign?: string;
  page?: number;
  limit?: number;
}

export class GetCatalogInventoryUseCase {
  constructor(private inventoryRepository: ICatalogInventoryRepository) {}

  async execute(filters: GetCatalogInventoryFilters): Promise<Result<{ data: CatalogInventory[]; total: number; page: number; limit: number }>> {
    try {
      const result = await this.inventoryRepository.findMany(filters);
      
      return Result.ok({
        data: result.data,
        total: result.total,
        page: filters.page || 1,
        limit: filters.limit || 20
      });
    } catch (error) {
      console.error('GetCatalogInventoryUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al obtener inventario');
    }
  }
}
