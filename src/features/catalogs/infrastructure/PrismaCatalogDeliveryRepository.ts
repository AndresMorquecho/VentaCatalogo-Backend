import { prisma } from '../../../lib/prisma';
import { CatalogDelivery } from '../domain/CatalogDelivery.entity';
import { ICatalogDeliveryRepository } from '../domain/ICatalogDeliveryRepository';

export class PrismaCatalogDeliveryRepository implements ICatalogDeliveryRepository {
  async findMany(filters: {
    clientId?: string;
    brandId?: string;
    campaign?: string;
    type?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: CatalogDelivery[]; total: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.clientId && filters.clientId !== 'undefined') where.clientId = filters.clientId;
    if (filters.brandId && filters.brandId !== 'undefined') where.brandId = filters.brandId;
    if (filters.campaign && filters.campaign !== 'undefined') where.campaign = filters.campaign;
    if (filters.type && filters.type !== 'undefined') where.type = filters.type;

    if (filters.startDate && !isNaN(filters.startDate.getTime())) {
      where.deliveredAt = { ...where.deliveredAt, gte: filters.startDate };
    }
    if (filters.endDate && !isNaN(filters.endDate.getTime())) {
      where.deliveredAt = { ...where.deliveredAt, lte: filters.endDate };
    }

    const [deliveries, total] = await Promise.all([
      prisma.catalogDelivery.findMany({
        where,
        include: {
          client: {
            select: { id: true, firstName: true, identificationNumber: true }
          },
          brand: {
            select: { id: true, name: true }
          },
          order: {
            select: { id: true, receiptNumber: true, total: true }
          }
        },
        orderBy: { deliveredAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.catalogDelivery.count({ where })
    ]);

    const data = deliveries.map(del =>
      CatalogDelivery.create(
        {
          clientId: del.clientId,
          clientName: del.client.firstName,
          brandId: del.brandId,
          brandName: del.brand.name,
          campaign: del.campaign,
          quantity: del.quantity,
          type: del.type as any,
          orderId: del.orderId || undefined,
          catalogInventoryId: del.catalogInventoryId,
          deliveredBy: del.deliveredBy,
          deliveredAt: del.deliveredAt,
          notes: del.notes || undefined
        },
        del.id
      )
    );

    return { data, total };
  }

  async findLastDeliveryByClientAndBrand(clientId: string, brandId: string): Promise<CatalogDelivery | null> {
    const delivery = await prisma.catalogDelivery.findFirst({
      where: { clientId, brandId },
      orderBy: { deliveredAt: 'desc' }
    });

    if (!delivery) return null;

    return CatalogDelivery.create(
      {
        clientId: delivery.clientId,
        brandId: delivery.brandId,
        campaign: delivery.campaign,
        quantity: delivery.quantity,
        type: delivery.type as any,
        orderId: delivery.orderId || undefined,
        catalogInventoryId: delivery.catalogInventoryId,
        deliveredBy: delivery.deliveredBy,
        deliveredAt: delivery.deliveredAt,
        notes: delivery.notes || undefined
      },
      delivery.id
    );
  }

  async save(delivery: CatalogDelivery): Promise<CatalogDelivery> {
    const data = delivery.toJSON();
    
    const created = await prisma.catalogDelivery.create({
      data: {
        id: data.id,
        clientId: data.clientId,
        brandId: data.brandId,
        campaign: data.campaign,
        quantity: data.quantity,
        type: data.type,
        orderId: data.orderId,
        catalogInventoryId: data.catalogInventoryId,
        deliveredBy: data.deliveredBy,
        deliveredAt: data.deliveredAt,
        notes: data.notes
      }
    });

    return CatalogDelivery.create(
      {
        clientId: created.clientId,
        brandId: created.brandId,
        campaign: created.campaign,
        quantity: created.quantity,
        type: created.type as any,
        orderId: created.orderId || undefined,
        catalogInventoryId: created.catalogInventoryId,
        deliveredBy: created.deliveredBy,
        deliveredAt: created.deliveredAt,
        notes: created.notes || undefined
      },
      created.id
    );
  }
}
