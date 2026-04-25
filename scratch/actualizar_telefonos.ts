/**
 * ACTUALIZACIÓN DE TELÉFONOS DESDE EXCEL
 * =========================================
 * Modo DRY_RUN=true  → Solo muestra qué cambiaría, NO modifica nada (default)
 * Modo DRY_RUN=false → Ejecuta los cambios en transacción atómica
 *
 * USO:
 *   DRY-RUN (seguro):  npx tsx scratch/actualizar_telefonos.ts
 *   EJECUTAR:          DRY_RUN=false npx tsx scratch/actualizar_telefonos.ts
 *
 * REGLAS DE SEGURIDAD:
 *   ✅ Solo actualiza clientes con phone1 = "0000000000"
 *   ✅ Solo actualiza si la cédula del Excel tiene match en BD
 *   ✅ Solo toca phone1 y phone2 — ningún otro campo
 *   ✅ Transacción atómica: si algo falla, nada se guarda
 *   ✅ Log completo de cada cambio realizado
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const EXCEL_PATH = path.join(__dirname, '../EXCEL/NumerosCelularEmpresarias.xlsx');

// ============================================================
// CONFIGURACIÓN — cambiar a false solo cuando estés listo
// ============================================================
const DRY_RUN = process.env.DRY_RUN !== 'false'; // true por defecto

// ============================================================
// FUNCIONES DE NORMALIZACIÓN
// ============================================================

function cleanPhone(raw: any): string | null {
    if (raw === null || raw === undefined) return null;
    let str = String(raw).trim();
    if (!str || str === '0') return null;
    // Remover decimales tipo Excel (.0, .00)
    str = str.replace(/\.0+$/, '');
    // Solo dígitos
    const digits = str.replace(/\D/g, '');
    if (!digits || digits.length < 7) return null;
    // Si tiene 9 dígitos y no empieza con 0, agregar 0 adelante
    if (digits.length === 9 && !digits.startsWith('0')) {
        return '0' + digits;
    }
    return digits;
}

function cleanCedula(raw: any): string | null {
    if (raw === null || raw === undefined) return null;
    let str = String(raw).trim();
    if (!str) return null;
    str = str.replace(/\.0+$/, '');
    const digits = str.replace(/\D/g, '');
    if (!digits) return null;
    // Si tiene 9 dígitos, agregar 0 adelante
    if (digits.length === 9) return '0' + digits;
    return digits;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    console.log('='.repeat(70));
    console.log('ACTUALIZACIÓN DE TELÉFONOS DESDE EXCEL');
    console.log('='.repeat(70));
    
    if (DRY_RUN) {
        console.log('🔵 MODO: DRY-RUN — No se modificará ningún dato');
        console.log('   Para ejecutar cambios: DRY_RUN=false npx tsx scratch/actualizar_telefonos.ts');
    } else {
        console.log('🔴 MODO: EJECUCIÓN REAL — Se modificarán registros en producción');
    }
    console.log();

    // --- 1. Leer Excel ---
    console.log('📖 Leyendo Excel...');
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheet = workbook.Sheets['Sheet1'];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    const dataRows = rawRows.slice(1); // Saltar cabecera

    // Columnas: [0]=unnamed, [1]=Identificación, [2]=Empresaria, [3]=Teléfono 1, [4]=Teléfono 2
    const excelMap = new Map<string, { nombre: string; tel1: string; tel2: string | null }>();

    for (const row of dataRows) {
        const cedula = cleanCedula(row[1]);
        const nombre = String(row[2] || '').trim();
        const tel1 = cleanPhone(row[3]);
        const tel2 = cleanPhone(row[4]);

        if (cedula && tel1) {
            // En caso de duplicados en el Excel, queda el último
            excelMap.set(cedula, { nombre, tel1, tel2 });
        }
    }

    console.log(`   → ${excelMap.size} entradas únicas con cédula y teléfono válidos`);

    // --- 2. Obtener clientes con teléfono en ceros ---
    console.log('\n📡 Consultando BD (clientes con teléfono en ceros)...');
    const clientsToCheck = await (prisma as any).client.findMany({
        where: { phone1: { startsWith: '000000' } },
        select: {
            id: true,
            identificationNumber: true,
            firstName: true,
            phone1: true,
            phone2: true,
        }
    });
    console.log(`   → ${clientsToCheck.length} clientes encontrados con phone1 = 0000000000`);

    // --- 3. Cruzar y preparar actualizaciones ---
    const updates: {
        id: string;
        cedula: string;
        nombre: string;
        phone1_viejo: string;
        phone2_viejo: string | null;
        phone1_nuevo: string;
        phone2_nuevo: string | null;
    }[] = [];

    const sinMatch: { cedula: string; nombre: string }[] = [];

    for (const client of clientsToCheck) {
        const cedNorm = cleanCedula(client.identificationNumber);
        const excelRow = cedNorm ? excelMap.get(cedNorm) : undefined;

        if (excelRow) {
            updates.push({
                id: client.id,
                cedula: client.identificationNumber,
                nombre: client.firstName,
                phone1_viejo: client.phone1,
                phone2_viejo: client.phone2,
                phone1_nuevo: excelRow.tel1,
                phone2_nuevo: excelRow.tel2,
            });
        } else {
            sinMatch.push({ cedula: client.identificationNumber, nombre: client.firstName });
        }
    }

    // --- 4. Mostrar resumen ---
    console.log('\n' + '='.repeat(70));
    console.log('RESUMEN');
    console.log('='.repeat(70));
    console.log(`✅ Actualizaciones preparadas: ${updates.length}`);
    console.log(`⚠️  Sin match en Excel (no se tocarán): ${sinMatch.length}`);
    console.log(`📊 Total clientes con teléfono en ceros: ${clientsToCheck.length}`);

    console.log('\n📝 DETALLE DE CAMBIOS PROPUESTOS:');
    console.log('─'.repeat(100));
    updates.forEach((u, i) => {
        const tel2Info = u.phone2_nuevo ? ` | Tel2: "${u.phone2_viejo ?? 'null'}" → "${u.phone2_nuevo}"` : '';
        console.log(`${String(i + 1).padStart(3)}. Cédula: ${u.cedula.padEnd(12)} | Tel1: "${u.phone1_viejo}" → "${u.phone1_nuevo}"${tel2Info} | ${u.nombre}`);
    });

    if (sinMatch.length > 0) {
        console.log('\n⚠️  SIN MATCH (no se modificarán):');
        sinMatch.forEach(m => {
            console.log(`     Cédula: ${m.cedula.padEnd(15)} | ${m.nombre}`);
        });
    }

    // --- 5. Ejecutar si no es DRY-RUN ---
    if (DRY_RUN) {
        console.log('\n' + '='.repeat(70));
        console.log('✅ DRY-RUN completado — NINGÚN dato fue modificado');
        console.log('   Cuando estés listo para aplicar los cambios ejecuta:');
        console.log('   DRY_RUN=false npx tsx scratch/actualizar_telefonos.ts');
        console.log('='.repeat(70));
    } else {
        const BATCH_SIZE = 20;
        console.log(`\n🔴 EJECUTANDO ACTUALIZACIONES EN LOTES DE ${BATCH_SIZE}...`);

        let totalOk = 0;
        let totalErr = 0;
        const failed: typeof updates = [];

        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(updates.length / BATCH_SIZE);

            try {
                await prisma.$transaction(async (tx: any) => {
                    for (const u of batch) {
                        const updateData: any = { phone1: u.phone1_nuevo };
                        if (u.phone2_nuevo !== null) {
                            updateData.phone2 = u.phone2_nuevo;
                        }
                        await tx.client.update({
                            where: { id: u.id },
                            data: updateData
                        });
                        totalOk++;
                        console.log(`  [${totalOk}/${updates.length}] ✅ ${u.cedula} → ${u.phone1_nuevo} | ${u.nombre}`);
                    }
                }, { timeout: 30000 });
                console.log(`  Lote ${batchNum}/${totalBatches} completado ✅`);
            } catch (err) {
                console.error(`  ❌ Lote ${batchNum}/${totalBatches} FALLÓ — revertido`);
                console.error(err);
                totalErr += batch.length;
                failed.push(...batch);
            }
        }

        console.log('\n' + '='.repeat(70));
        console.log(`🎉 COMPLETADO: ${totalOk} registros actualizados`);
        if (totalErr > 0) {
            console.log(`⚠️  ${totalErr} registros NO actualizados por error:`);
            failed.forEach(f => console.log(`   Cédula: ${f.cedula} | ${f.nombre}`));
        }
        console.log('='.repeat(70));
    }

    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error('Error fatal:', e);
    await prisma.$disconnect();
    process.exit(1);
});
