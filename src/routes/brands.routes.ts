import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, requirePermission('brands.view'), async (req, res, next) => {
  try {
    const { include_inactive } = req.query;
    const brands = await prisma.brand.findMany({
      where: include_inactive === 'true' ? {} : { isActive: true },
      orderBy: { name: 'asc' }
    });
    return res.json({ success: true, data: brands });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', authenticate, requirePermission('brands.view'), async (req, res, next) => {
  try {
    const brand = await prisma.brand.findUnique({
      where: { id: req.params.id }
    });
    if (!brand) {
      return res.status(404).json({ success: false, error: { message: 'Marca no encontrada' } });
    }
    return res.json({ success: true, data: brand });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authenticate, requirePermission('brands.create'), async (req, res, next) => {
  try {
    const { name, description, is_active, isActive } = req.body;
    const brand = await prisma.brand.create({
      data: {
        name,
        description,
        isActive: isActive !== undefined ? isActive : (is_active !== undefined ? is_active : true)
      }
    });
    return res.status(201).json({ success: true, data: brand });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', authenticate, requirePermission('brands.edit'), async (req, res, next) => {
  try {
    const { name, description, is_active, isActive } = req.body;
    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;
    else if (is_active !== undefined) updateData.isActive = is_active;

    const brand = await prisma.brand.update({
      where: { id: req.params.id },
      data: updateData
    });
    return res.json({ success: true, data: brand });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', authenticate, requirePermission('brands.delete'), async (req, res, next) => {
  try {
    const brandOrders = await prisma.order.count({
      where: { brandId: req.params.id }
    });

    if (brandOrders > 0) {
      await prisma.brand.update({
        where: { id: req.params.id },
        data: { isActive: false }
      });
      return res.json({ success: true, message: 'La marca tiene pedidos asociados, ha sido marcada como inactiva.' });
    }

    await prisma.brand.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: 'Marca eliminada correctamente' });
  } catch (error) {
    return next(error);
  }
});

export default router;
