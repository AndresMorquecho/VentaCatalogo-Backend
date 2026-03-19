import { Result } from '../../../shared/domain/Result';
import { CatalogInventory } from '../domain/CatalogInventory.entity';
import { ICatalogInventoryRepository } from '../domain/ICatalogInventoryRepository';
import { prisma } from '../../../lib/prisma';

export interface CreateCatalogInventoryDTO {
  brandId: string;
  campaign: string;
  quantity: number;
}

export class CreateCatalogInventoryUseCase {
  constructor(private inventoryRepository: ICatalogInventoryRepository) {}

  async execute(dto: CreateCatalogInventoryDTO, createdBy: string): Promise<Result<CatalogInventory>> {
    try {
      // Validaciones
      if (!dto.brandId || !dto.campaign || dto.quantity <= 0) {
        return Result.fail('Datos inválidos: marca, campaña y cantidad son requeridos');
      }

      // Verificar que la marca existe y está activa
      const brand = await prisma.brand.findUnique({
        where: { id: dto.brandId }
      });

      if (!brand) {
        return Result.fail('Marca no encontrada');
      }

      if (!brand.isActive) {
        return Result.fail('La marca no está activa');
      }

      // Verificar si ya existe inventario para esta marca + campaña
      const existing = await this.inventoryRepository.findByBrandAndCampaign(
        dto.brandId,
        dto.campaign
      );

      if (existing) {
        // Incrementar cantidad existente
        existing.incrementQuantity(dto.quantity);
        const updated = await this.inventoryRepository.update(existing);
        return Result.ok(updated);
      }

      // Crear nuevo inventario
      const inventory = CatalogInventory.create(
        {
          brandId: dto.brandId,
          campaign: dto.campaign,
          quantity: dto.quantity,
          createdBy,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        crypto.randomUUID()
      );

      const saved = await this.inventoryRepository.save(inventory);
      return Result.ok(saved);
    } catch (error) {
      console.error('CreateCatalogInventoryUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al crear inventario');
    }
  }
}
