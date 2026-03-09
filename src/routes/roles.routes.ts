import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Protect all role routes - Admin only
router.use(authenticate);
router.use(authorize('ADMIN'));

// GET all roles
router.get('/', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
        const skip = (page - 1) * limit;

        const [roles, total] = await Promise.all([
            prisma.role.findMany({
                orderBy: { name: 'asc' },
                skip,
                take: limit
            }),
            prisma.role.count()
        ]);

        res.json({
            success: true,
            data: roles,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {

        next(error);
    }
});

// CREATE role
router.post('/', async (req, res, next) => {
    try {
        const { name, description, permissions, isActive } = req.body;

        const existing = await prisma.role.findUnique({ where: { name } });
        if (existing) {
            throw new AppError(400, 'El nombre del rol ya está en uso', 'ROLE_EXISTS');
        }

        const role = await prisma.role.create({
            data: {
                name,
                description,
                permissions: permissions || [],
                isActive: true
            }
        });

        res.status(201).json({ success: true, data: role });
    } catch (error) {
        next(error);
    }
});

// UPDATE role
router.put('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, description, permissions, isActive } = req.body;

        const existing = await prisma.role.findUnique({ where: { id } });
        if (!existing) throw new AppError(404, 'Role not found', 'NOT_FOUND');

        const isEditingAdmin = existing.name.toUpperCase() === 'ADMIN';

        const role = await prisma.role.update({
            where: { id },
            data: {
                name: isEditingAdmin ? existing.name : (name || existing.name),
                description: isEditingAdmin ? existing.description : (description !== undefined ? description : existing.description),
                permissions: isEditingAdmin ? existing.permissions : (permissions || existing.permissions),
                isActive: true
            }
        });

        res.json({ success: true, data: role });
    } catch (error) {
        next(error);
    }
});

// DELETE role
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        const role = await prisma.role.findUnique({ where: { id } });
        if (!role) throw new AppError(404, 'Role not found', 'NOT_FOUND');

        if (role.name.toUpperCase() === 'ADMIN') {
            throw new AppError(400, 'El rol de Administrador es vital para el sistema y no puede ser eliminado', 'ADMIN_ROLE_PROTECTED');
        }

        // Prevent deleting built-in ADMIN role if you want, or check if used
        const usersWithRole = await prisma.user.count({
            where: { role: role.name }
        });

        if (usersWithRole > 0) {
            throw new AppError(400, 'No se puede eliminar un rol que tiene usuarios asignados', 'ROLE_IN_USE');
        }

        await prisma.role.delete({ where: { id } });

        res.json({ success: true, message: 'Rol eliminado exitosamente' });
    } catch (error) {
        next(error);
    }
});

export default router;
