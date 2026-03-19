import { Result } from '../../../shared/domain/Result';
import { CatalogDelivery, CatalogDeliveryType } from '../domain/CatalogDelivery.entity';
import { ICatalogDeliveryRepository } from '../domain/ICatalogDeliveryRepository';
import { ICatalogInventoryRepository } from '../domain/ICatalogInventoryRepository';
import { prisma } from '../../../lib/prisma';

export interface CreateCatalogDeliveryDTO {
  clientId: string;
  brandId: string;
  campaign: string;
  quantity: number;
  type: CatalogDeliveryType;
  orderId?: string;
  notes?: string;
}

export class CreateCatalogDeliveryUseCase {
  constructor(
    private deliveryRepository: ICatalogDeliveryRepository,
    private inventoryRepository: ICatalogInventoryRepository
  ) {}

  async execute(dto: CreateCatalogDeliveryDTO, deliveredBy: string): Promise<Result<CatalogDelivery>> {
    try {
      // Validaciones básicas
      if (!dto.clientId || !dto.brandId || !dto.campaign || dto.quantity <= 0) {
        return Result.fail('Datos inválidos: cliente, marca, campaña y cantidad son requeridos');
      }

      if (dto.type === 'CON_COSTO' && !dto.orderId) {
        return Result.fail('Para catálogos con costo, el ID de pedido es obligatorio');
      }

      // Verificar que el cliente existe y no está bloqueado
      const client = await prisma.client.findUnique({
        where: { id: dto.clientId }
      });

      if (!client) {
        return Result.fail('Cliente no encontrado');
      }

      if (client.isBlocked) {
        return Result.fail('El cliente está bloqueado');
      }

      // Verificar que la marca existe y está activa
      const brand = await prisma.brand.findUnique({
        where: { id: dto.brandId }
      });

      if (!brand || !brand.isActive) {
        return Result.fail('Marca no encontrada o inactiva');
      }

      // Buscar inventario
      const inventory = await this.inventoryRepository.findByBrandAndCampaign(
        dto.brandId,
        dto.campaign
      );

      if (!inventory) {
        return Result.fail('No existe inventario para esta marca y campaña');
      }

      if (inventory.quantity < dto.quantity) {
        return Result.fail(`Stock insuficiente. Disponible: ${inventory.quantity}`);
      }

      // Si es CON_COSTO, validar que el pedido existe y pertenece a la marca
      if (dto.type === 'CON_COSTO' && dto.orderId) {
        const order = await prisma.order.findUnique({
          where: { id: dto.orderId }
        });

        if (!order) {
          return Result.fail('Pedido no encontrado');
        }

        if (order.brandId !== dto.brandId) {
          return Result.fail('El pedido no pertenece a la marca seleccionada');
        }
      }

      // Ejecutar en transacción
      const result = await prisma.$transaction(async (tx) => {
        // 1. Crear delivery
        const delivery = CatalogDelivery.create(
          {
            clientId: dto.clientId,
            brandId: dto.brandId,
            campaign: dto.campaign,
            quantity: dto.quantity,
            type: dto.type,
            orderId: dto.orderId,
            catalogInventoryId: inventory.id,
            deliveredBy,
            deliveredAt: new Date(),
            notes: dto.notes
          },
          crypto.randomUUID()
        );

        const deliveryData = delivery.toJSON();
        const created = await tx.catalogDelivery.create({
          data: {
            id: deliveryData.id,
            clientId: deliveryData.clientId,
            brandId: deliveryData.brandId,
            campaign: deliveryData.campaign,
            quantity: deliveryData.quantity,
            type: deliveryData.type,
            orderId: deliveryData.orderId,
            catalogInventoryId: deliveryData.catalogInventoryId,
            deliveredBy: deliveryData.deliveredBy,
            deliveredAt: deliveryData.deliveredAt,
            notes: deliveryData.notes
          }
        });

        // 2. Decrementar stock
        await tx.catalogInventory.update({
          where: { id: inventory.id },
          data: { quantity: { decrement: dto.quantity } }
        });

        return CatalogDelivery.create(
          {
            clientId: created.clientId,
            brandId: created.brandId,
            campaign: created.campaign,
            quantity: created.quantity,
            type: created.type as CatalogDeliveryType,
            orderId: created.orderId || undefined,
            catalogInventoryId: created.catalogInventoryId,
            deliveredBy: created.deliveredBy,
            deliveredAt: created.deliveredAt,
            notes: created.notes || undefined
          },
          created.id
        );
      });

      return Result.ok(result);
    } catch (error) {
      console.error('CreateCatalogDeliveryUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al crear entrega');
    }
  }
}
