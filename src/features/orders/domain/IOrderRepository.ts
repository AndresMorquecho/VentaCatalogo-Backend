import { Order } from './Order.entity';

export interface OrderFilters {
  status?: string;
  clientId?: string;
  brandId?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
}

export interface IOrderRepository {
  findAll(filters: OrderFilters): Promise<Order[]>;
  findById(id: string): Promise<Order | null>;
  save(order: Order): Promise<Order>;
  update(order: Order): Promise<Order>;
  delete(id: string): Promise<void>;
  generateReceiptNumber(): Promise<string>;
}
