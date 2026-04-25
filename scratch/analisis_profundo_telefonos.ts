/**
 * ANÁLISIS PROFUNDO DEL EXCEL - SOLO LECTURA
 * Entiende la columna duplicada y el offset de filas
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const EXCEL_PATH = path.join(__dirname, '../EXCEL/NumerosCelularEmpresarias.xlsx');

function cleanPhone(raw: any): string | null {
    if (raw === null || raw === undefined) return null;
    let str = String(raw).trim();
    if (!str || str === '0') return null;
    // Remover decimales
    str = str.replace(/\.0+$/, '');
    // Solo dígitos
    const digits = str.replace(/\D/g, '');
    if (!digits || digits.length < 7) return null;
    // Si tiene 9 dígitos, agregar 0 adelante (cédulas/tels ecuatorianos sin el 0)
    if (digits.length === 9) return '0' + digits;
    return digits;
}

function cleanCedula(raw: any): string | null {
    if (raw === null || raw === undefined) return null;
    let str = String(raw).trim();
    if (!str) return null;
    str = str.replace(/\.0+$/, '');
    const digits = str.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 9) return '0' + digits;
    return digits;
}

async function main() {
    console.log('='.repeat(70));
    console.log('ANÁLISIS PROFUNDO DEL EXCEL vs BASE DE DATOS');
    console.log('='.repeat(70));
    console.log('⚠️  SOLO LECTURA\n');

    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheet = workbook.Sheets['Sheet1'];
    
    // Leer con header manual para entender el offset
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    
    console.log('Fila 0 (cabeceras reales del xlsx):');
    console.log(raw[0]);
    console.log('\nFila 1:');
    console.log(raw[1]);
    console.log('\nFila 2:');
    console.log(raw[2]);
    console.log('\nFila 3:');
    console.log(raw[3]);
    
    // La primera fila es la cabecera
    // Columna 0 = parece ser la CÉDULA original (sin nombre)
    // Columna 1 = "Identificación"
    // Columna 2 = "Empresaria" 
    // Columna 3 = "Teléfono 1"
    // Columna 4 = "Teléfono 2"
    
    // Leer todas las filas de datos (saltar la cabecera)
    const dataRows = raw.slice(1);
    
    // Intentar entender qué columna es la cédula correcta
    // La col[1] = "Identificación" parece ser la cédula oficial
    // La col[0] (sin nombre) parece ser otra referencia - quizás cédula del registro anterior?
    
    console.log('\n\nMuestra de 10 filas con todas las columnas:');
    console.log('Col0(unnamed) | Col1(Identificacion) | Col2(Empresaria) | Col3(Tel1) | Col4(Tel2)');
    dataRows.slice(0, 10).forEach((row: any[], i) => {
        console.log(`Fila ${i+2}: [${row[0]}] | [${row[1]}] | [${row[2]}] | [${row[3]}] | [${row[4]}]`);
    });
    
    // Procesar usando Col1 como cédula (Identificación) y Col3/Col4 como teléfonos
    const excelData: { cedula: string; nombre: string; tel1: string | null; tel2: string | null }[] = [];
    
    for (const row of dataRows) {
        const cedula = cleanCedula(row[1]); // Columna "Identificación"
        const nombre = String(row[2] || '').trim();
        const tel1 = cleanPhone(row[3]);     // "Teléfono 1"
        const tel2 = cleanPhone(row[4]);     // "Teléfono 2"
        
        if (cedula && tel1) {
            excelData.push({ cedula, nombre, tel1, tel2 });
        }
    }
    
    console.log(`\n\n📋 Filas válidas en Excel (con cédula Y teléfono): ${excelData.length}`);
    
    // Ahora cruzar contra la base de datos
    console.log('\n🔍 Cruzando con base de datos...');
    
    // Obtener todos los clientes con phone1 = 0000000000
    const clientsWithZeroPhone = await (prisma as any).client.findMany({
        where: { phone1: { startsWith: '000000' } },
        select: { 
            id: true,
            identificationNumber: true, 
            firstName: true, 
            phone1: true, 
            phone2: true 
        }
    });
    
    console.log(`\n📊 Clientes en BD con teléfono en ceros: ${clientsWithZeroPhone.length}`);
    
    // Crear mapa del Excel: cédula → datos
    const excelMap = new Map<string, typeof excelData[0]>();
    for (const row of excelData) {
        excelMap.set(row.cedula, row);
    }
    
    // Cruzar
    let matchCount = 0;
    let noMatchCount = 0;
    const matches: any[] = [];
    const noMatches: any[] = [];
    
    for (const client of clientsWithZeroPhone) {
        const cedNorm = cleanCedula(client.identificationNumber);
        const excelRow = cedNorm ? excelMap.get(cedNorm) : undefined;
        
        if (excelRow) {
            matchCount++;
            matches.push({
                cedula_bd: client.identificationNumber,
                nombre_bd: client.firstName,
                phone1_actual: client.phone1,
                phone1_nuevo: excelRow.tel1,
                phone2_nuevo: excelRow.tel2,
                nombre_excel: excelRow.nombre
            });
        } else {
            noMatchCount++;
            noMatches.push({
                cedula: client.identificationNumber,
                nombre: client.firstName
            });
        }
    }
    
    console.log(`\n✅ Clientes que SÍ tienen match en el Excel (se podrían actualizar): ${matchCount}`);
    console.log(`❌ Clientes que NO están en el Excel (quedarían sin actualizar): ${noMatchCount}`);
    
    if (matches.length > 0) {
        console.log('\n📝 DETALLE DE ACTUALIZACIONES PROPUESTAS (sin ejecutar):');
        console.log('─'.repeat(100));
        matches.forEach((m, i) => {
            console.log(`${i + 1}. Cédula: ${m.cedula_bd} | BD: "${m.phone1_actual}" → Excel Tel1: "${m.phone1_nuevo}" | Tel2: "${m.phone2_nuevo ?? 'sin cambio'}" | ${m.nombre_bd}`);
        });
    }
    
    if (noMatches.length > 0) {
        console.log(`\n❌ CLIENTES SIN MATCH EN EXCEL (${noMatches.length}) — no se actualizarían:`);
        noMatches.forEach(m => {
            console.log(`   Cédula: ${m.cedula} | ${m.nombre}`);
        });
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('FIN DEL ANÁLISIS - No se modificó ningún dato');
    console.log('='.repeat(70));
    
    await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); });
