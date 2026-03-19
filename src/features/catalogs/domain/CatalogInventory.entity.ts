import { Entity } from '../../../shared/domain/Entity';

interface CatalogInventoryProps {
  brandId: string;
  brandName?: string; // Opcional para compatibilidad
  campaign: string;
  quantity: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export class CatalogInventory extends Entity<CatalogInventoryProps> {
  private constructor(props: CatalogInventoryProps, id?: string) {
    super(props, id);
  }

  static create(props: CatalogInventoryProps, id?: string): CatalogInventory {
    return new CatalogInventory(props, id);
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

  get createdBy(): string {
    return this.props.createdBy;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  incrementQuantity(amount: number): void {
    this.props.quantity += amount;
    this.props.updatedAt = new Date();
  }

  decrementQuantity(amount: number): void {
    if (this.props.quantity < amount) {
      throw new Error('Stock insuficiente');
    }
    this.props.quantity -= amount;
    this.props.updatedAt = new Date();
  }

  toJSON() {
    return {
      id: this.id,
      brandId: this.brandId,
      brandName: this.brandName,
      campaign: this.campaign,
      quantity: this.quantity,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}
