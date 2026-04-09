import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class SystemSettingsController {
    
    async getSettings(_req: Request, res: Response) {
        try {
            const settings = await prisma.systemSettings.findMany();
            return res.json(settings);
        } catch (error) {
            console.error('Error fetching settings:', error);
            return res.status(500).json({ error: 'Error al obtener configuraciones' });
        }
    }

    async updateSetting(req: Request, res: Response) {
        const { key } = req.params;
        const { value } = req.body;
        const updatedBy = (req as any).user?.username || 'system';

        try {
            const setting = await prisma.systemSettings.upsert({
                where: { key },
                update: { 
                    value, 
                    updatedAt: new Date(),
                    updatedByName: updatedBy
                },
                create: { 
                    key, 
                    value,
                    updatedByName: updatedBy
                }
            });
            return res.json(setting);
        } catch (error) {
            console.error('Error updating setting:', error);
            return res.status(500).json({ error: 'Error al actualizar configuración' });
        }
    }

    async getNoteTemplates(_req: Request, res: Response) {
        try {
            const notes = await prisma.noteTemplate.findMany({
                orderBy: { createdAt: 'desc' }
            });
            return res.json(notes);
        } catch (error) {
            console.error('Error fetching notes:', error);
            return res.status(500).json({ error: 'Error al obtener plantillas de notas' });
        }
    }

    async getDefaultNote(_req: Request, res: Response) {
        try {
            const note = await prisma.noteTemplate.findFirst({
                where: { isDefault: true, isActive: true }
            });
            return res.json(note || { content: '' });
        } catch (error) {
            console.error('Error fetching default note:', error);
            return res.status(500).json({ error: 'Error al obtener nota predeterminada' });
        }
    }

    async upsertNote(req: Request, res: Response) {
        const { id, title, content, isDefault, isActive } = req.body;
        const createdBy = (req as any).user?.username || 'system';

        try {
            // If setting as default, unset others first
            if (isDefault) {
                await prisma.noteTemplate.updateMany({
                    where: { type: 'NOTIMONCHITO' },
                    data: { isDefault: false }
                });
            }

            const note = await prisma.noteTemplate.upsert({
                where: { id: id || 'new-id' }, // Placeholder for new
                update: { 
                    title, 
                    content, 
                    isDefault, 
                    isActive,
                    updatedAt: new Date()
                },
                create: {
                    title,
                    content,
                    type: 'NOTIMONCHITO',
                    isDefault,
                    isActive,
                    createdByName: createdBy
                }
            });
            return res.json(note);
        } catch (error) {
            console.error('Error upserting note:', error);
            return res.status(500).json({ error: 'Error al guardar plantilla de nota' });
        }
    }

    async deleteNote(req: Request, res: Response) {
        const { id } = req.params;
        try {
            await prisma.noteTemplate.delete({
                where: { id }
            });
            return res.json({ success: true });
        } catch (error) {
            console.error('Error deleting note:', error);
            return res.status(500).json({ error: 'Error al eliminar plantilla' });
        }
    }

    // Order Types
    async getOrderTypes(_req: Request, res: Response) {
        try {
            const types = await prisma.orderType.findMany({
                orderBy: { name: 'asc' }
            });
            return res.json(types);
        } catch (error) {
            console.error('Error fetching order types:', error);
            return res.status(500).json({ error: 'Error al obtener tipos de pedido' });
        }
    }

    async upsertOrderType(req: Request, res: Response) {
        const { id, name, description, isActive, isSystem } = req.body;
        try {
            const type = await prisma.orderType.upsert({
                where: { id: id || '00000000-0000-0000-0000-000000000000' }, // Use a valid UUID format for dummy
                update: { name, description, isActive, isSystem: isSystem || false },
                create: { name, description, isActive: isActive ?? true, isSystem: isSystem || false }
            });
            return res.json(type);
        } catch (error) {
            console.error('Error upserting order type:', error);
            return res.status(500).json({ error: 'Error al guardar tipo de pedido' });
        }
    }

    async deleteOrderType(req: Request, res: Response) {
        const { id } = req.params;
        try {
            await prisma.orderType.delete({ where: { id } });
            return res.json({ success: true });
        } catch (error) {
            console.error('Error deleting order type:', error);
            return res.status(500).json({ error: 'Error al eliminar tipo de pedido' });
        }
    }

    // Sales Channels
    async getSalesChannels(_req: Request, res: Response) {
        try {
            const channels = await prisma.salesChannel.findMany({
                orderBy: { name: 'asc' }
            });
            return res.json(channels);
        } catch (error) {
            console.error('Error fetching sales channels:', error);
            return res.status(500).json({ error: 'Error al obtener canales de venta' });
        }
    }

    async upsertSalesChannel(req: Request, res: Response) {
        const { id, name, description, isActive } = req.body;
        try {
            const channel = await prisma.salesChannel.upsert({
                where: { id: id || '00000000-0000-0000-0000-000000000000' },
                update: { name, description, isActive },
                create: { name, description, isActive: isActive ?? true }
            });
            return res.json(channel);
        } catch (error) {
            console.error('Error upserting sales channel:', error);
            return res.status(500).json({ error: 'Error al guardar canal de venta' });
        }
    }

    async deleteSalesChannel(req: Request, res: Response) {
        const { id } = req.params;
        try {
            await prisma.salesChannel.delete({ where: { id } });
            return res.json({ success: true });
        } catch (error) {
            console.error('Error deleting sales channel:', error);
            return res.status(500).json({ error: 'Error al eliminar canal de venta' });
        }
    }
}
