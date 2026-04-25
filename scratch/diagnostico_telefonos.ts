/**
 * DIAGNÓSTICO DE TELÉFONOS - SOLO LECTURA
 * No modifica ningún dato. Solo muestra el estado actual.
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('='.repeat(70));
    console.log('DIAGNÓSTICO DE TELÉFONOS - BASE DE DATOS PRODUCCIÓN');
    console.log('='.repeat(70));
    console.log('⚠️  MODO SOLO LECTURA — No se modifica ningún dato\n');

    // 1. Total de clientes
    const totalClients = await (prisma as any).client.count();
    console.log(`📊 Total de clientes en BD: ${totalClients}`);

    // 2. Clientes con phone1 = "0000000000" o similar (todo ceros)
    const ceroPhone = await (prisma as any).client.findMany({
        where: {
            phone1: { contains: '0000000' }
        },
        select: {
            identificationNumber: true,
            firstName: true,
            phone1: true,
            phone2: true,
        },
        orderBy: { firstName: 'asc' }
    });

    console.log(`\n📱 Clientes con teléfono en ceros (0000000000 o similar): ${ceroPhone.length}`);
    if (ceroPhone.length > 0) {
        console.log('\nDetalle:');
        ceroPhone.forEach((c: any) => {
            console.log(`  Cédula: ${c.identificationNumber} | Nombre: ${c.firstName} | phone1: ${c.phone1} | phone2: ${c.phone2}`);
        });
    }

    // 3. Clientes cuya cédula termina en ".0" (importación Excel malformada)
    const cedularWithDot = await (prisma as any).client.findMany({
        where: {
            identificationNumber: { endsWith: '.0' }
        },
        select: {
            identificationNumber: true,
            firstName: true,
            phone1: true,
        }
    });
    console.log(`\n🔢 Clientes con cédula que termina en ".0": ${cedularWithDot.length}`);
    if (cedularWithDot.length > 0) {
        cedularWithDot.forEach((c: any) => {
            console.log(`  Cédula actual: ${c.identificationNumber} | Nombre: ${c.firstName}`);
        });
    }

    // 4. Clientes cuyo phone1 termina en ".0" (teléfono malformado tipo Excel)
    const phoneWithDot = await (prisma as any).client.findMany({
        where: {
            phone1: { endsWith: '.0' }
        },
        select: {
            identificationNumber: true,
            firstName: true,
            phone1: true,
        }
    });
    console.log(`\n📞 Clientes con phone1 que termina en ".0": ${phoneWithDot.length}`);
    if (phoneWithDot.length > 0) {
        phoneWithDot.forEach((c: any) => {
            console.log(`  Cédula: ${c.identificationNumber} | Nombre: ${c.firstName} | phone1 actual: ${c.phone1}`);
        });
    }

    // 5. Clientes con phone1 que tiene longitud distinta de 10 (números ecuatorianos esperan 10 dígitos)
    const allClients = await (prisma as any).client.findMany({
        select: {
            identificationNumber: true,
            firstName: true,
            phone1: true,
        }
    });
    
    const wrongLength = allClients.filter((c: any) => 
        c.phone1 && c.phone1 !== '0000000000' && c.phone1.replace(/\D/g, '').length !== 10
    );
    console.log(`\n⚠️  Clientes con phone1 de longitud distinta a 10 dígitos: ${wrongLength.length}`);
    if (wrongLength.length > 0 && wrongLength.length <= 30) {
        wrongLength.forEach((c: any) => {
            console.log(`  Cédula: ${c.identificationNumber} | Nombre: ${c.firstName} | phone1: "${c.phone1}" (${c.phone1.length} chars)`);
        });
    } else if (wrongLength.length > 30) {
        console.log(`  (Mostrando primeros 30)`);
        wrongLength.slice(0, 30).forEach((c: any) => {
            console.log(`  Cédula: ${c.identificationNumber} | Nombre: ${c.firstName} | phone1: "${c.phone1}" (${c.phone1.length} chars)`);
        });
    }

    console.log('\n' + '='.repeat(70));
    console.log('FIN DEL DIAGNÓSTICO - No se modificó ningún dato');
    console.log('='.repeat(70));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
