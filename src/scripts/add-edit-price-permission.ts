/**
 * Script: add-edit-price-permission.ts
 * 
 * Agrega el permiso 'orders.edit_price' al rol ADMIN en la base de datos.
 * Ejecutar una sola vez con: npx tsx src/scripts/add-edit-price-permission.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NEW_PERMISSION = 'orders.edit_price';

async function main() {
    console.log('--- Agregando permiso orders.edit_price al rol Administrador ---');

    const roles = await prisma.role.findMany();
    const adminRoles = roles.filter(r =>
        r.name.toUpperCase() === 'ADMIN' ||
        r.name.toLowerCase().includes('administrador')
    );

    if (adminRoles.length === 0) {
        console.log('⚠️  No se encontraron roles administrativos.');
        return;
    }

    for (const role of adminRoles) {
        const currentPermissions: string[] = (role.permissions as string[]) || [];
        
        if (currentPermissions.includes(NEW_PERMISSION)) {
            console.log(`✅ El rol "${role.name}" ya tiene el permiso '${NEW_PERMISSION}'. Sin cambios.`);
            continue;
        }

        const updatedPermissions = [...currentPermissions, NEW_PERMISSION];
        await prisma.role.update({
            where: { id: role.id },
            data: { permissions: updatedPermissions }
        });

        console.log(`✅ Permiso '${NEW_PERMISSION}' agregado al rol "${role.name}". Total permisos: ${updatedPermissions.length}`);
    }

    console.log('\n¡Proceso completado!');
    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
