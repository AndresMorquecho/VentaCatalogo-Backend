import { CatalogDelivery } from './CatalogDelivery.entity';

export interface ICatalogDeliveryRepository {
  findMany(filters: {
    clientId?: string;
    brandId?: string;
    campaign?: string;
    type?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: CatalogDelivery[]; total: number }>;
  findLastDeliveryByClientAndBrand(clientId: string, brandId: string): Promise<CatalogDelivery | null>;
  save(delivery: CatalogDelivery): Promise<CatalogDelivery>;
}
