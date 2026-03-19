import { prisma } from '../../../lib/prisma';
import { CatalogInventory } from '../domain/CatalogInventory.entity';
import { ICatalogInventoryRepository } from '../domain/ICatalogInventoryRepository';

export class PrismaCatalogInventoryRepository implements ICatalogInventoryRepository {
  async findByBrandAndCampaign(brandId: string, campaign: string): Promise<CatalogInventory | null> {
    const inventory = await prisma.catalogInventory.findUnique({
      where: {
        brandId_campaign: { brandId, campaign }
      }
    });

    if (!inventory) return null;

    return CatalogInventory.create(
      {
        brandId: inventory.brandId,
        campaign: inventory.campaign,
        quantity: inventory.quantity,
        createdBy: inventory.createdBy,
        createdAt: inventory.createdAt,
        updatedAt: inventory.updatedAt
      },
      inventory.id
    );
  }

  async findMany(filters: {
    brandId?: string;
    campaign?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: CatalogInventory[]; total: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.brandId) where.brandId = filters.brandId;
    if (filters.campaign) where.campaign = filters.campaign;

    const [inventories, total] = await Promise.all([
      prisma.catalogInventory.findMany({
        where,
        include: {
          brand: {
            select: { id: true, name: true }
          },
          _count: {
            select: { deliveries: true }
          }
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.catalogInventory.count({ where })
    ]);

    const data = inventories.map(inv =>
      CatalogInventory.create(
        {
          brandId: inv.brandId,
          brandName: inv.brand.name, // Agregar nombre de marca
          campaign: inv.campaign,
          quantity: inv.quantity,
          createdBy: inv.createdBy,
          createdAt: inv.createdAt,
          updatedAt: inv.updatedAt
        },
        inv.id
      )
    );

    return { data, total };
  }

  async save(inventory: CatalogInventory): Promise<CatalogInventory> {
    const data = inventory.toJSON();
    
    const created = await prisma.catalogInventory.create({
      data: {
        id: data.id,
        brandId: data.brandId,
        campaign: data.campaign,
        quantity: data.quantity,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      }
    });

    return CatalogInventory.create(
      {
        brandId: created.brandId,
        campaign: created.campaign,
        quantity: created.quantity,
        createdBy: created.createdBy,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt
      },
      created.id
    );
  }

  async update(inventory: CatalogInventory): Promise<CatalogInventory> {
    const data = inventory.toJSON();
    
    const updated = await prisma.catalogInventory.update({
      where: { id: data.id },
      data: {
        quantity: data.quantity,
        updatedAt: data.updatedAt
      }
    });

    return CatalogInventory.create(
      {
        brandId: updated.brandId,
        campaign: updated.campaign,
        quantity: updated.quantity,
        createdBy: updated.createdBy,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt
      },
      updated.id
    );
  }
}
