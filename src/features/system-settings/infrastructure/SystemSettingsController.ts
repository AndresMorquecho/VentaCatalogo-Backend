import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class SystemSettingsController {
    
    async getSettings(_req: Request, res: Response) {
        try {
            const settings = await prisma.systemSettings.findMany();
            res.json(settings);
        } catch (error) {
            console.error('Error fetching settings:', error);
            res.status(500).json({ error: 'Error al obtener configuraciones' });
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
            res.json(setting);
        } catch (error) {
            console.error('Error updating setting:', error);
            res.status(500).json({ error: 'Error al actualizar configuración' });
        }
    }

    async getNoteTemplates(_req: Request, res: Response) {
        try {
            const notes = await prisma.noteTemplate.findMany({
                orderBy: { createdAt: 'desc' }
            });
            res.json(notes);
        } catch (error) {
            console.error('Error fetching notes:', error);
            res.status(500).json({ error: 'Error al obtener plantillas de notas' });
        }
    }

    async getDefaultNote(_req: Request, res: Response) {
        try {
            const note = await prisma.noteTemplate.findFirst({
                where: { isDefault: true, isActive: true }
            });
            res.json(note || { content: '' });
        } catch (error) {
            console.error('Error fetching default note:', error);
            res.status(500).json({ error: 'Error al obtener nota predeterminada' });
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
            res.json(note);
        } catch (error) {
            console.error('Error upserting note:', error);
            res.status(500).json({ error: 'Error al guardar plantilla de nota' });
        }
    }

    async deleteNote(req: Request, res: Response) {
        const { id } = req.params;
        try {
            await prisma.noteTemplate.delete({
                where: { id }
            });
            res.json({ success: true });
        } catch (error) {
            console.error('Error deleting note:', error);
            res.status(500).json({ error: 'Error al eliminar plantilla' });
        }
    }
}
