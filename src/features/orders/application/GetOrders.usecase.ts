import { IOrderRepository, OrderFilters } from '../domain/IOrderRepository';
import { Order } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';

export class GetOrdersUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(filters: OrderFilters): Promise<Result<Order[]>> {
    try {
      const orders = await this.orderRepository.findAll(filters);
      return Result.ok(orders);
    } catch (error) {
      return Result.fail(error instanceof Error ? error.message : 'Failed to get orders');
    }
  }
}
