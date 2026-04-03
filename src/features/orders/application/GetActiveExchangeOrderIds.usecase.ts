import { prisma } from '../../../lib/prisma';

/**
 * GetActiveExchangeOrderIdsUseCase
 * 
 * Retorna los IDs de pedidos que están en ExchangeBatchItem
 * donde el ExchangeBatch NO está en estado "ENTREGADO".
 * 
 * Esto permite al frontend filtrar pedidos que ya están en
 * exchanges activos y no deben ser seleccionables nuevamente.
 */
export class GetActiveExchangeOrderIdsUseCase {
  async execute(clientId?: string): Promise<string[]> {
    const where: any = {
      batch: {
        status: { not: 'ENTREGADO' }
      }
    };
    
    if (clientId) {
      where.clientId = clientId;
    }
    
    const items = await prisma.exchangeBatchItem.findMany({
      where,
      select: { orderId: true },
      distinct: ['orderId']
    });
    
    return items.map(item => item.orderId);
  }
}
