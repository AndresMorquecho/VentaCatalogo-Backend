
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('--- ACTUALIZANDO PERMISOS DE CIERRE DE CAJA ---');
    
    // 1. Buscar el rol ADMIN
    const adminRole = await prisma.role.findUnique({
      where: { name: 'ADMIN' }
    });

    if (!adminRole) {
      console.error('No se encontró el rol ADMIN.');
      return;
    }

    const currentPermissions = adminRole.permissions;
    if (currentPermissions.includes('cash_closure.view_all')) {
      console.log('El rol ADMIN ya tiene el permiso cash_closure.view_all.');
    } else {
      console.log('Añadiendo cash_closure.view_all al rol ADMIN...');
      const updatedPermissions = [...currentPermissions, 'cash_closure.view_all'];
      
      await prisma.role.update({
        where: { name: 'ADMIN' },
        data: { permissions: updatedPermissions }
      });
      console.log('Permiso añadido exitosamente al rol ADMIN.');
    }

    // 2. Verificar el cambio
    const verifiedRole = await prisma.role.findUnique({
      where: { name: 'ADMIN' }
    });
    console.log('Permisos finales ADMIN:', verifiedRole.permissions);

  } catch (error) {
    console.error('Error durante la actualización:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
