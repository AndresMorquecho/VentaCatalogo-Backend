import { Entity } from '../../../shared/domain/Entity';

export type CatalogDeliveryType = 'GRATIS' | 'CON_COSTO';

interface CatalogDeliveryProps {
  clientId: string;
  clientName?: string;
  brandId: string;
  brandName?: string;
  campaign: string;
  quantity: number;
  type: CatalogDeliveryType;
  orderId?: string;
  catalogInventoryId: string;
  deliveredBy: string;
  deliveredAt: Date;
  notes?: string;
}

export class CatalogDelivery extends Entity<CatalogDeliveryProps> {
  private constructor(props: CatalogDeliveryProps, id?: string) {
    super(props, id);
  }

  static create(props: CatalogDeliveryProps, id?: string): CatalogDelivery {
    return new CatalogDelivery(props, id);
  }

  get clientId(): string {
    return this.props.clientId;
  }

  get clientName(): string | undefined {
    return this.props.clientName;
  }

  get brandId(): string {
    return this.props.brandId;
  }

  get brandName(): string | undefined {
    return this.props.brandName;
  }

  get campaign(): string {
    return this.props.campaign;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get type(): CatalogDeliveryType {
    return this.props.type;
  }

  get orderId(): string | undefined {
    return this.props.orderId;
  }

  get catalogInventoryId(): string {
    return this.props.catalogInventoryId;
  }

  get deliveredBy(): string {
    return this.props.deliveredBy;
  }

  get deliveredAt(): Date {
    return this.props.deliveredAt;
  }

  get notes(): string | undefined {
    return this.props.notes;
  }

  toJSON() {
    return {
      id: this.id,
      clientId: this.clientId,
      clientName: this.clientName,
      brandId: this.brandId,
      brandName: this.brandName,
      campaign: this.campaign,
      quantity: this.quantity,
      type: this.type,
      orderId: this.orderId,
      catalogInventoryId: this.catalogInventoryId,
      deliveredBy: this.deliveredBy,
      deliveredAt: this.deliveredAt,
      notes: this.notes
    };
  }
}
