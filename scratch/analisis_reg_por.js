/**
 * ANÁLISIS: ¿Por qué REG. POR aparece vacío en abonos?
 * SOLO LECTURA - Sin cambios
 */
const { Client } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function analizar() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('='.repeat(80));
  console.log('ANÁLISIS: ¿POR QUÉ "REG. POR" APARECE VACÍO EN ABONOS?');
  console.log('='.repeat(80));

  try {
    // 1. Columnas de order_payments
    console.log('\n📋 COLUMNAS DE order_payments:');
    const opCols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='order_payments'
      ORDER BY ordinal_position
    `);
    opCols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type} | nullable: ${r.is_nullable}`));

    const tieneCreatedBy = opCols.rows.some(r => r.column_name === 'created_by' || r.column_name === 'createdBy');
    console.log(`\n  ¿Tiene columna created_by?: ${tieneCreatedBy ? '✅ SÍ' : '❌ NO'}`);

    // 2. Columnas de financial_records
    console.log('\n📋 COLUMNAS DE financial_records:');
    const frCols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='financial_records'
      ORDER BY ordinal_position
    `);
    frCols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type} | nullable: ${r.is_nullable}`));

    const frCreatedBy = frCols.rows.find(r => r.column_name === 'created_by');
    console.log(`\n  ¿Tiene columna created_by en financial_records?: ${frCreatedBy ? '✅ SÍ' : '❌ NO'}`);

    // 3. Muestra de financial_records - revisar si created_by está siendo grabado
    console.log('\n📋 ÚLTIMOS 10 REGISTROS DE financial_records (tipo PAYMENT):');
    const frSamples = await client.query(`
      SELECT id, type, created_by, order_payment_id, payment_method, amount, created_at
      FROM financial_records
      WHERE type = 'PAYMENT'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    frSamples.rows.forEach(r => {
      const createdBy = r.created_by || '(VACÍO)';
      const icono = r.created_by ? '✅' : '❌';
      console.log(`  ${icono} ID: ${r.id.substring(0,8)}... | created_by: "${createdBy}" | método: ${r.payment_method} | monto: $${r.amount} | payment_id: ${r.order_payment_id?.substring(0,8) || 'NULL'}...`);
    });

    // 4. Contar cuántos financial_records tienen created_by vacío
    console.log('\n📋 ESTADÍSTICAS DE created_by EN financial_records:');
    const stats = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE created_by IS NOT NULL AND created_by != '') AS con_usuario,
        COUNT(*) FILTER (WHERE created_by IS NULL OR created_by = '') AS sin_usuario,
        COUNT(*) AS total
      FROM financial_records WHERE type = 'PAYMENT'
    `);
    const s = stats.rows[0];
    console.log(`  Total pagos: ${s.total}`);
    console.log(`  Con usuario (created_by): ${s.con_usuario}`);
    console.log(`  Sin usuario (vacío/NULL): ${s.sin_usuario}`);

    // 5. Abonos provenientes de entrega (BatchDeliverOrders / DeliverOrder)
    console.log('\n📋 PAGOS POR SOURCE (de dónde vienen los pagos):');
    const sources = await client.query(`
      SELECT source, COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_by IS NOT NULL AND created_by != '') as con_usuario,
        COUNT(*) FILTER (WHERE created_by IS NULL OR created_by = '') as sin_usuario
      FROM financial_records
      WHERE type = 'PAYMENT'
      GROUP BY source
      ORDER BY total DESC
    `);
    sources.rows.forEach(r => {
      console.log(`  ${r.source || 'NULL'}: total=${r.total} | con_usuario=${r.con_usuario} | sin_usuario=${r.sin_usuario}`);
    });

    // 6. ¿El link payment → financialRecord funciona?
    console.log('\n📋 VERIFICAR LINK order_payments ↔ financial_records:');
    const linkCheck = await client.query(`
      SELECT 
        op.id AS payment_id,
        op.method,
        op.amount,
        op.created_at,
        fr.id AS fr_id,
        fr.created_by,
        fr.source
      FROM order_payments op
      LEFT JOIN financial_records fr ON fr.order_payment_id = op.id AND fr.type = 'PAYMENT'
      ORDER BY op.created_at DESC
      LIMIT 15
    `);
    console.log(`  Muestra de últimos 15 pagos con su financial_record:`);
    linkCheck.rows.forEach(r => {
      const tieneLink = r.fr_id ? '✅ Vinculado' : '❌ SIN FR';
      const tieneUser = r.created_by ? `✅ "${r.created_by}"` : '❌ (vacío)';
      console.log(`  ${tieneLink} | payment: ${r.payment_id.substring(0,8)}... | método: ${r.method} | $${r.amount} | createdBy: ${tieneUser} | source: ${r.source || 'NULL'}`);
    });

    // 7. Pagos desde módulo de ENTREGA/RECEPCION
    console.log('\n📋 PAGOS DESDE ENTREGA (source = DELIVERY o similares):');
    const deliveryPayments = await client.query(`
      SELECT source, created_by, payment_method, amount, created_at
      FROM financial_records
      WHERE type = 'PAYMENT' AND source IN ('DELIVERY', 'BATCH_DELIVERY', 'ORDER_PAYMENT', 'RECEPTION', 'BATCH_RECEPTION')
      ORDER BY created_at DESC
      LIMIT 20
    `);
    if (deliveryPayments.rows.length === 0) {
      console.log('  No hay registros con esos sources. Verificando sources disponibles...');
      const allSources = await client.query(`SELECT DISTINCT source FROM financial_records ORDER BY source`);
      console.log('  Sources en BD:', allSources.rows.map(r => r.source).join(', '));
    } else {
      deliveryPayments.rows.forEach(r => {
        const user = r.created_by || '(VACÍO)';
        console.log(`  source: ${r.source} | by: "${user}" | método: ${r.payment_method} | $${r.amount}`);
      });
    }

  } catch(e) {
    console.error('ERROR:', e.message, e.stack);
  } finally {
    await client.end();
    console.log('\n✅ Cerrado. NINGÚN DATO MODIFICADO.');
  }
}
analizar();
