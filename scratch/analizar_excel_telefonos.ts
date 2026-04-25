/**
 * ANÁLISIS DEL EXCEL - SOLO LECTURA
 * Lee el archivo Excel y muestra su estructura y contenido
 * para entender qué datos contiene antes de cualquier acción.
 */

import * as XLSX from 'xlsx';
import * as path from 'path';

const EXCEL_PATH = path.join(__dirname, '../EXCEL/NumerosCelularEmpresarias.xlsx');

function normalizePhone(raw: any): string | null {
    if (raw === null || raw === undefined || raw === '') return null;
    
    // Convertir a string primero
    let str = String(raw).trim();
    
    // Eliminar decimales tipo Excel (.0, .00)
    if (str.endsWith('.0')) str = str.slice(0, -2);
    if (str.endsWith('.00')) str = str.slice(0, -3);
    
    // Eliminar caracteres no numéricos (espacios, guiones, etc)
    const digits = str.replace(/\D/g, '');
    
    if (!digits || digits === '0') return null;
    
    // Si tiene 9 dígitos y no empieza con 0, agregar el 0 adelante
    if (digits.length === 9 && !digits.startsWith('0')) {
        return '0' + digits;
    }
    
    // Si ya tiene 10 dígitos, está bien
    if (digits.length === 10) {
        return digits;
    }
    
    // Cualquier otro caso, retornar como está para revisión
    return digits;
}

function normalizeCedula(raw: any): string | null {
    if (raw === null || raw === undefined || raw === '') return null;
    
    let str = String(raw).trim();
    
    // Eliminar decimales tipo Excel (.0)
    if (str.endsWith('.0')) str = str.slice(0, -2);
    if (str.endsWith('.00')) str = str.slice(0, -3);
    
    // Solo dígitos
    const digits = str.replace(/\D/g, '');
    
    if (!digits) return null;
    
    // Cédulas ecuatorianas son de 10 dígitos
    // Si tiene 9 dígitos, agregar 0 adelante
    if (digits.length === 9) {
        return '0' + digits;
    }
    
    return digits;
}

function main() {
    console.log('='.repeat(70));
    console.log('ANÁLISIS DE EXCEL: NumerosCelularEmpresarias.xlsx');
    console.log('='.repeat(70));
    console.log('⚠️  MODO SOLO LECTURA — No se modifica ningún dato\n');

    const workbook = XLSX.readFile(EXCEL_PATH);
    
    console.log(`📑 Hojas disponibles: ${workbook.SheetNames.join(', ')}\n`);
    
    workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
        
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`📄 HOJA: "${sheetName}" — ${rows.length} filas`);
        console.log(`${'─'.repeat(70)}`);
        
        if (rows.length === 0) {
            console.log('  (Hoja vacía)');
            return;
        }
        
        // Mostrar columnas disponibles
        const columns = Object.keys(rows[0]);
        console.log(`\nColumnas (${columns.length}): ${columns.map(c => `"${c}"`).join(', ')}`);
        
        // Mostrar primeras 5 filas para entender el formato
        console.log('\nPrimeras 5 filas (valores crudos):');
        rows.slice(0, 5).forEach((row, i) => {
            console.log(`  Fila ${i + 1}:`, JSON.stringify(row));
        });
        
        // Intentar identificar columnas de cédula y teléfono
        const colLower = columns.map(c => c.toLowerCase());
        
        const cedCol = columns.find(c => 
            c.toLowerCase().includes('cedula') || 
            c.toLowerCase().includes('cédula') ||
            c.toLowerCase().includes('identificacion') ||
            c.toLowerCase().includes('identificación') ||
            c.toLowerCase().includes('cedula') ||
            c.toLowerCase() === 'ci' ||
            c.toLowerCase().includes('document')
        );
        
        const phoneCol1 = columns.find(c => 
            c.toLowerCase().includes('telefono') ||
            c.toLowerCase().includes('teléfono') ||
            c.toLowerCase().includes('celular') ||
            c.toLowerCase().includes('phone') ||
            c.toLowerCase().includes('tel') ||
            c.toLowerCase() === 'tel1' ||
            c.toLowerCase() === 'tel 1' ||
            c.toLowerCase().includes('telefono 1') ||
            c.toLowerCase().includes('telef')
        );
        
        const phoneCol2 = columns.find(c => 
            (c.toLowerCase().includes('telefono') || c.toLowerCase().includes('teléfono') || c.toLowerCase().includes('celular')) &&
            (c.includes('2') || c.toLowerCase().includes('dos') || c.toLowerCase().includes('alt'))
            && c !== phoneCol1
        );
        
        console.log(`\n🔍 Columna detectada para CÉDULA: ${cedCol ? `"${cedCol}"` : '❌ No detectada'}`);
        console.log(`🔍 Columna detectada para TELÉFONO 1: ${phoneCol1 ? `"${phoneCol1}"` : '❌ No detectada'}`);
        console.log(`🔍 Columna detectada para TELÉFONO 2: ${phoneCol2 ? `"${phoneCol2}"` : 'No detectada'}`);
        
        if (cedCol && phoneCol1) {
            console.log('\n📊 Análisis de normalización (muestra de valores problemáticos):');
            
            let totalRows = 0;
            let rowsWithCedula = 0;
            let rowsWithPhone = 0;
            let needsNormalization = 0;
            let malformedSamples: any[] = [];
            
            rows.forEach(row => {
                totalRows++;
                const rawCed = row[cedCol];
                const rawPhone = row[phoneCol1];
                
                if (rawCed) rowsWithCedula++;
                if (rawPhone && String(rawPhone) !== '0') rowsWithPhone++;
                
                const cedNorm = normalizeCedula(rawCed);
                const phoneNorm = normalizePhone(rawPhone);
                
                const rawCedStr = String(rawCed || '');
                const rawPhoneStr = String(rawPhone || '');
                
                const cedNeedsChange = rawCedStr !== cedNorm;
                const phoneNeedsChange = rawPhoneStr !== phoneNorm;
                
                if ((cedNeedsChange || phoneNeedsChange) && malformedSamples.length < 15) {
                    malformedSamples.push({
                        cédula_raw: rawCed,
                        cédula_normalizada: cedNorm,
                        teléfono_raw: rawPhone,
                        teléfono_normalizado: phoneNorm,
                        cedula_cambia: cedNeedsChange,
                        telefono_cambia: phoneNeedsChange
                    });
                }
                if (cedNeedsChange || phoneNeedsChange) needsNormalization++;
            });
            
            console.log(`\n  Total de filas en Excel:  ${totalRows}`);
            console.log(`  Filas con cédula:         ${rowsWithCedula}`);
            console.log(`  Filas con teléfono:       ${rowsWithPhone}`);
            console.log(`  Filas que necesitan normalización: ${needsNormalization}`);
            
            if (malformedSamples.length > 0) {
                console.log('\n  Ejemplos de datos que serían normalizados:');
                malformedSamples.forEach((s, i) => {
                    console.log(`  ${i + 1}. Cédula: ${s.cédula_raw} → ${s.cédula_normalizada} | Tel: ${s.teléfono_raw} → ${s.teléfono_normalizado}`);
                });
            }
        }
    });
    
    console.log('\n' + '='.repeat(70));
    console.log('FIN DEL ANÁLISIS - No se modificó ningún dato');
    console.log('='.repeat(70));
}

main();
