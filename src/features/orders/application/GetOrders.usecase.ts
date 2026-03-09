import { IOrderRepository, OrderFilters } from '../domain/IOrderRepository';
import { Order } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';

export class GetOrdersUseCase {
  constructor(private orderRepository: IOrderRepository) { }

  async execute(filters: OrderFilters): Promise<Result<{ data: Order[]; total: number }>> {
    try {
      const result = await this.orderRepository.findAll(filters);
      return Result.ok(result);
    } catch (error) {
      return Result.fail(error instanceof Error ? error.message : 'Failed to get orders');
    }
  }
}
