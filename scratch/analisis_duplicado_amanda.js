/**
 * ANÁLISIS COMPLETO DE DUPLICADO - SOLO LECTURA
 * Cliente a conservar: identification_number = '0703990580'
 * Cliente a fusionar:  identification_number = '763990580' o '0763990580'
 * NO SE REALIZAN CAMBIOS
 */

const { Client } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const DB_URL = process.env.DATABASE_URL;

async function analizar() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ Conectado a la base de datos (SOLO LECTURA)\n');
  console.log('='.repeat(90));
  console.log('ANÁLISIS DE DUPLICADO: AMANDA VERONICA MONTOYA SALVATIERRA');
  console.log('='.repeat(90));

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // PASO 1: Encontrar ambos registros
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n📋 PASO 1: REGISTROS EN clients\n');
    const ambos = await client.query(`
      SELECT * FROM clients
      WHERE identification_number IN ('0703990580', '703990580', '0763990580', '763990580')
         OR first_name ILIKE '%amanda%salvatierra%'
      ORDER BY identification_number
    `);

    console.log(`Registros encontrados: ${ambos.rows.length}`);
    ambos.rows.forEach((r, i) => {
      console.log(`\n--- Cliente ${i + 1} ---`);
      Object.entries(r).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    });

    if (ambos.rows.length < 2) {
      console.log('\n⚠️  Menos de 2 registros. Búsqueda amplia por nombre...');
      const amplio = await client.query(`SELECT * FROM clients WHERE first_name ILIKE '%amanda%'`);
      console.log(`Resultados con nombre "amanda": ${amplio.rows.length}`);
      amplio.rows.forEach((r, i) => {
        console.log(`\n-- ${i+1} --`);
        Object.entries(r).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
      });
      if (ambos.rows.length === 0) return;
    }

    const cliente_conservar = ambos.rows.find(r => r.identification_number === '0703990580');
    const cliente_fusionar   = ambos.rows.find(r =>
      ['763990580', '0763990580', '703990580'].includes(r.identification_number)
    );

    if (!cliente_conservar || !cliente_fusionar) {
      console.log('\n❌ No se pudieron identificar los dos clientes.');
      console.log('IDs encontrados:');
      ambos.rows.forEach(r => console.log(`  ID: ${r.id} | Num: ${r.identification_number} | Nombre: ${r.first_name}`));
      return;
    }

    const ID_CONSERVAR = cliente_conservar.id;
    const ID_FUSIONAR  = cliente_fusionar.id;

    console.log(`\n✅ CONSERVAR: ID=${ID_CONSERVAR} | Cédula=${cliente_conservar.identification_number}`);
    console.log(`⚠️  FUSIONAR:  ID=${ID_FUSIONAR}  | Cédula=${cliente_fusionar.identification_number}`);

    // ──────────────────────────────────────────────────────────────────────────
    // PASO 2: FK hacia clients
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n📋 PASO 2: TODAS LAS FK QUE APUNTAN A clients\n');
    const fks = await client.query(`
      SELECT
        tc.table_name  AS tabla_hija,
        kcu.column_name AS col_fk,
        rc.delete_rule,
        rc.update_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'clients'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name
    `);

    console.log(`Tablas con FK hacia clients: ${fks.rows.length}`);
    fks.rows.forEach(r => {
      console.log(`  • ${r.tabla_hija}.${r.col_fk} | ON DELETE: ${r.delete_rule} | ON UPDATE: ${r.update_rule}`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // PASO 3: Conteo por tabla
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n📋 PASO 3: CONTEO DE REGISTROS POR TABLA\n');
    const sep = '-'.repeat(90);
    console.log(`${'TABLA'.padEnd(28)} ${'COLUMNA FK'.padEnd(20)} ${'CONSERVAR'.padEnd(12)} ${'FUSIONAR'.padEnd(12)} TOTAL`);
    console.log(sep);

    let granTotal = { conservar: 0, fusionar: 0 };
    const detalleTablas = [];

    for (const { tabla_hija: tabla, col_fk: col } of fks.rows) {
      try {
        const qC = await client.query(`SELECT COUNT(*) FROM "${tabla}" WHERE "${col}" = $1`, [ID_CONSERVAR]);
        const qF = await client.query(`SELECT COUNT(*) FROM "${tabla}" WHERE "${col}" = $1`, [ID_FUSIONAR]);
        const nC = parseInt(qC.rows[0].count);
        const nF = parseInt(qF.rows[0].count);
        const total = nC + nF;
        granTotal.conservar += nC;
        granTotal.fusionar  += nF;
        detalleTablas.push({ tabla, col, nC, nF, total });
        const alerta = nF > 0 ? '⚠️ ' : '   ';
        console.log(`${alerta}${tabla.padEnd(26)} ${col.padEnd(20)} ${String(nC).padEnd(12)} ${String(nF).padEnd(12)} ${total}`);
      } catch(e) {
        console.log(`  ❌ Error en ${tabla}: ${e.message}`);
      }
    }
    console.log(sep);
    console.log(`${'TOTALES'.padEnd(48)} ${String(granTotal.conservar).padEnd(12)} ${String(granTotal.fusionar).padEnd(12)} ${granTotal.conservar + granTotal.fusionar}`);

    // ──────────────────────────────────────────────────────────────────────────
    // PASO 4: DETALLE DE PEDIDOS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n📋 PASO 4: DETALLE DE PEDIDOS (orders)\n');

    // Primero ver columnas de orders
    const orderCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='orders'
      ORDER BY ordinal_position
    `);
    console.log('Columnas de orders:', orderCols.rows.map(r => r.column_name).join(', '));

    const pedidosC = await client.query(`SELECT * FROM orders WHERE client_id = $1 ORDER BY created_at`, [ID_CONSERVAR]);
    const pedidosF = await client.query(`SELECT * FROM orders WHERE client_id = $1 ORDER BY created_at`, [ID_FUSIONAR]);

    // Si falla, intenta con clientId
    console.log(`\nPedidos CONSERVAR (${ID_CONSERVAR}): ${pedidosC.rows.length}`);
    pedidosC.rows.forEach(p => {
      console.log(`  • ID: ${p.id} | N°: ${p.order_number || p.orderNumber || 'N/A'} | Total: $${p.total} | Estado: ${p.status} | Fecha: ${p.created_at || p.createdAt}`);
    });

    console.log(`\nPedidos FUSIONAR (${ID_FUSIONAR}): ${pedidosF.rows.length}`);
    pedidosF.rows.forEach(p => {
      console.log(`  • ID: ${p.id} | N°: ${p.order_number || p.orderNumber || 'N/A'} | Total: $${p.total} | Estado: ${p.status} | Fecha: ${p.created_at || p.createdAt}`);
    });

    const totalVentasC = pedidosC.rows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
    const totalVentasF = pedidosF.rows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
    console.log(`\n💰 Total ventas CONSERVAR: $${totalVentasC.toFixed(2)}`);
    console.log(`💰 Total ventas FUSIONAR:  $${totalVentasF.toFixed(2)}`);
    console.log(`💰 TOTAL COMBINADO:        $${(totalVentasC + totalVentasF).toFixed(2)}`);

    // ──────────────────────────────────────────────────────────────────────────
    // PASO 5: PAGOS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n📋 PASO 5: PAGOS (order_payments)\n');

    // Ver columnas de order_payments
    const paymentCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='order_payments'
      ORDER BY ordinal_position
    `);
    console.log('Columnas de order_payments:', paymentCols.rows.map(r => r.column_name).join(', '));

    const idsOrdenesC = pedidosC.rows.map(p => p.id);
    const idsOrdenesF = pedidosF.rows.map(p => p.id);

    if (idsOrdenesC.length > 0) {
      const pagosC = await client.query(
        `SELECT op.*, o.order_number FROM order_payments op JOIN orders o ON op.order_id = o.id WHERE op.order_id = ANY($1) ORDER BY op.created_at`,
        [idsOrdenesC]
      );
      const totalPagosC = pagosC.rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
      console.log(`Pagos CONSERVAR: ${pagosC.rows.length} | Total: $${totalPagosC.toFixed(2)}`);
      pagosC.rows.forEach(p => {
        console.log(`  • Pedido #${p.order_number} | Monto: $${p.amount} | Método: ${p.payment_method || p.method} | Fecha: ${p.created_at}`);
      });
    } else {
      console.log('Pagos CONSERVAR: 0 pedidos');
    }

    if (idsOrdenesF.length > 0) {
      const pagosF = await client.query(
        `SELECT op.*, o.order_number FROM order_payments op JOIN orders o ON op.order_id = o.id WHERE op.order_id = ANY($1) ORDER BY op.created_at`,
        [idsOrdenesF]
      );
      const totalPagosF = pagosF.rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
      console.log(`\nPagos FUSIONAR: ${pagosF.rows.length} | Total: $${totalPagosF.toFixed(2)}`);
      pagosF.rows.forEach(p => {
        console.log(`  • Pedido #${p.order_number} | Monto: $${p.amount} | Método: ${p.payment_method || p.method} | Fecha: ${p.created_at}`);
      });
    } else {
      console.log('Pagos FUSIONAR: 0 pedidos');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PASO 6: TABLAS ADICIONALES DE ALTA IMPORTANCIA FINANCIERA
    // ──────────────────────────────────────────────────────────────────────────
    const tablasFinancieras = ['client_accounts', 'client_credits', 'wallet_recharges', 'financial_records', 'loyalty_redemptions', 'reward_applications'];
    console.log('\n\n📋 PASO 6: TABLAS FINANCIERAS ADICIONALES\n');

    for (const tabla of tablasFinancieras) {
      try {
        const cols2 = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [tabla]
        );
        const colFk = cols2.rows.find(r => r.column_name === 'client_id');
        if (!colFk) {
          console.log(`  ⏭️  ${tabla}: sin columna client_id directa`);
          continue;
        }
        const rC = await client.query(`SELECT * FROM "${tabla}" WHERE client_id = $1`, [ID_CONSERVAR]);
        const rF = await client.query(`SELECT * FROM "${tabla}" WHERE client_id = $1`, [ID_FUSIONAR]);
        console.log(`\n  📁 ${tabla}:`);
        console.log(`    CONSERVAR: ${rC.rows.length} registros`);
        rC.rows.forEach(r => {
          const balance = r.balance !== undefined ? ` | balance: $${r.balance}` : '';
          const amount = r.amount !== undefined ? ` | amount: $${r.amount}` : '';
          console.log(`      ${JSON.stringify(r).substring(0, 120)}${balance}${amount}`);
        });
        console.log(`    FUSIONAR:  ${rF.rows.length} registros`);
        rF.rows.forEach(r => {
          console.log(`      ${JSON.stringify(r).substring(0, 120)}`);
        });
      } catch(e) {
        console.log(`  ❌ ${tabla}: ${e.message}`);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PASO 7: LLAMADAS, CATALOGOS, LOTES
    // ──────────────────────────────────────────────────────────────────────────
    const tablasOperativas = ['calls', 'catalog_deliveries', 'catalog_inventories', 'audit_logs'];
    console.log('\n\n📋 PASO 7: TABLAS OPERATIVAS\n');
    for (const tabla of tablasOperativas) {
      try {
        const cols3 = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [tabla]
        );
        const colFk = cols3.rows.find(r => r.column_name === 'client_id');
        if (!colFk) {
          // Intentar buscar alguna columna que diga client
          const colClient = cols3.rows.find(r => r.column_name.includes('client'));
          if (!colClient) {
            console.log(`  ⏭️  ${tabla}: sin FK a client encontrada (cols: ${cols3.rows.map(r=>r.column_name).join(', ')})`);
            continue;
          }
        }
        const col = 'client_id';
        const rC = await client.query(`SELECT COUNT(*) FROM "${tabla}" WHERE ${col} = $1`, [ID_CONSERVAR]);
        const rF = await client.query(`SELECT COUNT(*) FROM "${tabla}" WHERE ${col} = $1`, [ID_FUSIONAR]);
        console.log(`  ${tabla}: CONSERVAR=${rC.rows[0].count} | FUSIONAR=${rF.rows[0].count}`);
      } catch(e) {
        console.log(`  ℹ️  ${tabla}: ${e.message.substring(0,80)}`);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PASO 8: COMPARACIÓN DE CAMPOS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n📋 PASO 8: COMPARACIÓN CAMPO A CAMPO\n');
    const campos = Object.keys(cliente_conservar).filter(k => k !== 'id');
    let diferencias = 0;
    campos.forEach(campo => {
      const v1 = String(cliente_conservar[campo] ?? 'NULL');
      const v2 = String(cliente_fusionar[campo] ?? 'NULL');
      if (v1 !== v2) {
        diferencias++;
        console.log(`  ⚠️  ${campo}:`);
        console.log(`       CONSERVAR: "${v1}"`);
        console.log(`       FUSIONAR:  "${v2}"`);
      } else {
        console.log(`  ✅ ${campo}: "${v1}"`);
      }
    });
    console.log(`\nTotal diferencias: ${diferencias}`);

    // ──────────────────────────────────────────────────────────────────────────
    // RESUMEN EJECUTIVO FINAL
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n' + '='.repeat(90));
    console.log('RESUMEN EJECUTIVO - PLAN DE MERGE');
    console.log('='.repeat(90));
    console.log(`
✅ CLIENTE A CONSERVAR (ganador):
   ID:     ${ID_CONSERVAR}
   Cédula: ${cliente_conservar.identification_number}
   Nombre: ${cliente_conservar.first_name}
   Ciudad: ${cliente_conservar.city}
   Tel:    ${cliente_conservar.phone1}
   Email:  ${cliente_conservar.email}

❌ CLIENTE A FUSIONAR (se eliminará después del merge):
   ID:     ${ID_FUSIONAR}
   Cédula: ${cliente_fusionar.identification_number}
   Nombre: ${cliente_fusionar.first_name}
   Ciudad: ${cliente_fusionar.city}
   Tel:    ${cliente_fusionar.phone1}
   Email:  ${cliente_fusionar.email}
`);

    console.log('TABLAS QUE REQUIEREN UPDATE (donde fusionar.registros > 0):');
    detalleTablas.filter(t => t.nF > 0).forEach(t => {
      console.log(`  ⚠️  ${t.tabla}.${t.col}: ${t.nF} registros a reasignar → ${ID_CONSERVAR}`);
    });

    const totalRegistrosEnRiesgo = detalleTablas.reduce((s, t) => s + t.nF, 0);
    console.log(`\nTotal registros a reasignar: ${totalRegistrosEnRiesgo}`);
    console.log('\nRIESGOS IDENTIFICADOS:');
    console.log('  1. Si se borra el cliente sin hacer UPDATE de FKs primero → violación de FK o pérdida de datos');
    console.log('  2. Si hay campos únicos con conflicto (ej. misma cédula) → bloqueará la operación');
    console.log('  3. Diferencias de datos entre los dos registros → hay que elegir cuál prevalece');
    console.log('  4. referred_by_id → si otros clientes referencian al ID que se elimina');
    console.log('\n⚠️  NINGÚN CAMBIO FUE REALIZADO - ESTO ES SOLO ANÁLISIS');

  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    console.error(err.stack);
  } finally {
    await client.end();
    console.log('\n✅ Conexión cerrada. NINGÚN DATO FUE MODIFICADO.');
  }
}

analizar();
