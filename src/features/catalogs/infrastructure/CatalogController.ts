import { Request, Response } from 'express';
import { PrismaCatalogInventoryRepository } from './PrismaCatalogInventoryRepository';
import { PrismaCatalogDeliveryRepository } from './PrismaCatalogDeliveryRepository';
import { CreateCatalogInventoryUseCase } from '../application/CreateCatalogInventory.usecase';
import { GetCatalogInventoryUseCase } from '../application/GetCatalogInventory.usecase';
import { CreateCatalogDeliveryUseCase } from '../application/CreateCatalogDelivery.usecase';
import { GetCatalogDeliveriesUseCase } from '../application/GetCatalogDeliveries.usecase';
import { ValidateClientBehaviorUseCase } from '../application/ValidateClientBehavior.usecase';

export class CatalogController {
  private inventoryRepository = new PrismaCatalogInventoryRepository();
  private deliveryRepository = new PrismaCatalogDeliveryRepository();

  async createInventory(req: Request, res: Response) {
    try {
      const useCase = new CreateCatalogInventoryUseCase(this.inventoryRepository);
      const username = (req as any).user?.username || 'system';

      const result = await useCase.execute(
        {
          brandId: req.body.brand_id,
          campaign: req.body.campaign,
          quantity: Number(req.body.quantity)
        },
        username
      );

      if (result.isFailure) {
        return res.status(400).json({ success: false, error: result.error });
      }

      return res.status(201).json({
        success: true,
        data: result.getValue().toJSON()
      });
    } catch (error) {
      console.error('CatalogController.createInventory Error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al crear inventario'
      });
    }
  }

  async getInventory(req: Request, res: Response) {
    try {
      const useCase = new GetCatalogInventoryUseCase(this.inventoryRepository);

      const result = await useCase.execute({
        brandId: req.query.brand_id as string,
        campaign: req.query.campaign as string,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined
      });

      if (result.isFailure) {
        return res.status(400).json({ success: false, error: result.error });
      }

      const data = result.getValue();
      return res.json({
        success: true,
        data: data.data.map(inv => inv.toJSON()),
        pagination: {
          total: data.total,
          page: data.page,
          limit: data.limit,
          totalPages: Math.ceil(data.total / data.limit)
        }
      });
    } catch (error) {
      console.error('CatalogController.getInventory Error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al obtener inventario'
      });
    }
  }

  async validateBehavior(req: Request, res: Response) {
    try {
      const useCase = new ValidateClientBehaviorUseCase(this.deliveryRepository);

      const result = await useCase.execute({
        clientId: req.body.client_id,
        brandId: req.body.brand_id
      });

      if (result.isFailure) {
        return res.status(400).json({ success: false, error: result.error });
      }

      return res.json({
        success: true,
        data: result.getValue()
      });
    } catch (error) {
      console.error('CatalogController.validateBehavior Error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al validar comportamiento'
      });
    }
  }

  async createDelivery(req: Request, res: Response) {
    try {
      const useCase = new CreateCatalogDeliveryUseCase(
        this.deliveryRepository,
        this.inventoryRepository
      );
      const username = (req as any).user?.username || 'system';

      const result = await useCase.execute(
        {
          clientId: req.body.client_id,
          brandId: req.body.brand_id,
          campaign: req.body.campaign,
          quantity: Number(req.body.quantity),
          type: req.body.type,
          orderId: req.body.order_id,
          notes: req.body.notes
        },
        username
      );

      if (result.isFailure) {
        return res.status(400).json({ success: false, error: result.error });
      }

      return res.status(201).json({
        success: true,
        data: result.getValue().toJSON()
      });
    } catch (error) {
      console.error('CatalogController.createDelivery Error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al crear entrega'
      });
    }
  }

  async getDeliveries(req: Request, res: Response) {
    try {
      const useCase = new GetCatalogDeliveriesUseCase(this.deliveryRepository);

      const result = await useCase.execute({
        clientId: req.query.client_id as string,
        brandId: req.query.brand_id as string,
        campaign: req.query.campaign as string,
        type: req.query.type as string,
        startDate: req.query.start_date ? new Date(req.query.start_date as string) : undefined,
        endDate: req.query.end_date ? new Date(req.query.end_date as string) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined
      });

      if (result.isFailure) {
        return res.status(400).json({ success: false, error: result.error });
      }

      const data = result.getValue();
      return res.json({
        success: true,
        data: data.data,
        pagination: {
          total: data.total,
          page: data.page,
          limit: data.limit,
          totalPages: Math.ceil(data.total / data.limit)
        }
      });
    } catch (error) {
      console.error('CatalogController.getDeliveries Error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Error al obtener entregas'
      });
    }
  }
}
