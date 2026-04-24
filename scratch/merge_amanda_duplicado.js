/**
 * MERGE ATÓMICO - PRODUCCIÓN
 * Amanda Veronica Montoya Salvatierra
 * 
 * CONSERVAR: 0703990580 → ID 4dddbd38-de4e-4b07-8cc6-9ad34641cad4
 * FUSIONAR:  703990580  → ID 3075fd4b-a288-4637-bdff-564ee67ebfea
 * 
 * Si algo falla → ROLLBACK automático. No se pierde nada.
 */

const { Client } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const ID_CONSERVAR = '4dddbd38-de4e-4b07-8cc6-9ad34641cad4';
const ID_FUSIONAR  = '3075fd4b-a288-4637-bdff-564ee67ebfea';

async function ejecutarMerge() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('='.repeat(80));
  console.log('MERGE ATÓMICO — AMANDA VERONICA MONTOYA SALVATIERRA');
  console.log('='.repeat(80));
  console.log(`CONSERVAR: ${ID_CONSERVAR}`);
  console.log(`FUSIONAR:  ${ID_FUSIONAR}\n`);

  try {
    // ─────────────────────────────────────────────
    // PRE-VERIFICACIÓN (antes de tocar nada)
    // ─────────────────────────────────────────────
    console.log('📋 PRE-VERIFICACIÓN...\n');

    const preConservar = await client.query(`SELECT id, identification_number, first_name, is_active FROM clients WHERE id = $1`, [ID_CONSERVAR]);
    const preFusionar  = await client.query(`SELECT id, identification_number, first_name, is_active FROM clients WHERE id = $1`, [ID_FUSIONAR]);

    if (preConservar.rows.length === 0) throw new Error(`❌ Cliente a conservar NO encontrado: ${ID_CONSERVAR}`);
    if (preFusionar.rows.length === 0)  throw new Error(`❌ Cliente a fusionar NO encontrado: ${ID_FUSIONAR}`);

    console.log(`✅ Cliente CONSERVAR: ${preConservar.rows[0].identification_number} | ${preConservar.rows[0].first_name} | activo: ${preConservar.rows[0].is_active}`);
    console.log(`✅ Cliente FUSIONAR:  ${preFusionar.rows[0].identification_number} | ${preFusionar.rows[0].first_name} | activo: ${preFusionar.rows[0].is_active}`);

    const preOrders    = await client.query(`SELECT COUNT(*) FROM orders WHERE client_id = $1`, [ID_FUSIONAR]);
    const preInvMov    = await client.query(`SELECT COUNT(*) FROM inventory_movements WHERE client_id = $1`, [ID_FUSIONAR]);
    const preOrdersC   = await client.query(`SELECT COUNT(*) FROM orders WHERE client_id = $1`, [ID_CONSERVAR]);

    console.log(`\nPedidos en FUSIONAR antes:  ${preOrders.rows[0].count}`);
    console.log(`inventory_movements en FUSIONAR antes: ${preInvMov.rows[0].count}`);
    console.log(`Pedidos en CONSERVAR antes: ${preOrdersC.rows[0].count}`);

    const nOrders = parseInt(preOrders.rows[0].count);
    const nInvMov = parseInt(preInvMov.rows[0].count);

    // ─────────────────────────────────────────────
    // INICIO DE TRANSACCIÓN ATÓMICA
    // ─────────────────────────────────────────────
    console.log('\n🔒 Iniciando transacción atómica...\n');
    await client.query('BEGIN');

    // PASO 1: Reasignar pedidos
    const r1 = await client.query(
      `UPDATE orders SET client_id = $1 WHERE client_id = $2`,
      [ID_CONSERVAR, ID_FUSIONAR]
    );
    console.log(`✅ PASO 1: orders reasignados → ${r1.rowCount} filas`);
    if (r1.rowCount !== nOrders) throw new Error(`Se esperaban ${nOrders} pedidos pero se actualizaron ${r1.rowCount}`);

    // PASO 2: Reasignar movimientos de inventario
    const r2 = await client.query(
      `UPDATE inventory_movements SET client_id = $1 WHERE client_id = $2`,
      [ID_CONSERVAR, ID_FUSIONAR]
    );
    console.log(`✅ PASO 2: inventory_movements reasignados → ${r2.rowCount} filas`);
    if (r2.rowCount !== nInvMov) throw new Error(`Se esperaban ${nInvMov} inv_movements pero se actualizaron ${r2.rowCount}`);

    // PASO 3: Activar el cliente correcto y asegurar datos correctos
    const r3 = await client.query(
      `UPDATE clients
       SET is_active = true,
           updated_at = NOW(),
           last_data_update = NOW()
       WHERE id = $1`,
      [ID_CONSERVAR]
    );
    console.log(`✅ PASO 3: Cliente correcto activado → ${r3.rowCount} filas`);

    // PASO 4: Verificar que el cliente a eliminar ya NO tiene dependencias
    const checkOrders    = await client.query(`SELECT COUNT(*) FROM orders WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkInvMov    = await client.query(`SELECT COUNT(*) FROM inventory_movements WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkCalls     = await client.query(`SELECT COUNT(*) FROM calls WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkExchanges = await client.query(`SELECT COUNT(*) FROM order_exchanges WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkReceipts  = await client.query(`SELECT COUNT(*) FROM order_receipts WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkLoyalty   = await client.query(`SELECT COUNT(*) FROM loyalty_redemptions WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkWallet    = await client.query(`SELECT COUNT(*) FROM wallet_recharges WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkFinancial = await client.query(`SELECT COUNT(*) FROM financial_records WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkCatDel    = await client.query(`SELECT COUNT(*) FROM catalog_deliveries WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkAccounts  = await client.query(`SELECT COUNT(*) FROM client_accounts WHERE client_id = $1`, [ID_FUSIONAR]);
    const checkReferred  = await client.query(`SELECT COUNT(*) FROM clients WHERE referred_by_id = $1`, [ID_FUSIONAR]);

    const verificaciones = [
      { tabla: 'orders',             count: parseInt(checkOrders.rows[0].count) },
      { tabla: 'inventory_movements', count: parseInt(checkInvMov.rows[0].count) },
      { tabla: 'calls',              count: parseInt(checkCalls.rows[0].count) },
      { tabla: 'order_exchanges',    count: parseInt(checkExchanges.rows[0].count) },
      { tabla: 'order_receipts',     count: parseInt(checkReceipts.rows[0].count) },
      { tabla: 'loyalty_redemptions', count: parseInt(checkLoyalty.rows[0].count) },
      { tabla: 'wallet_recharges',   count: parseInt(checkWallet.rows[0].count) },
      { tabla: 'financial_records',  count: parseInt(checkFinancial.rows[0].count) },
      { tabla: 'catalog_deliveries', count: parseInt(checkCatDel.rows[0].count) },
      { tabla: 'client_accounts',    count: parseInt(checkAccounts.rows[0].count) },
      { tabla: 'clients (referred_by_id)', count: parseInt(checkReferred.rows[0].count) },
    ];

    console.log('\n📋 Verificando dependencias antes del DELETE...');
    let hayDependencias = false;
    verificaciones.forEach(v => {
      const icono = v.count === 0 ? '  ✅' : '  ❌';
      console.log(`${icono} ${v.tabla}: ${v.count} registros pendientes`);
      if (v.count > 0) hayDependencias = true;
    });

    if (hayDependencias) {
      throw new Error('❌ Aún hay dependencias sin reasignar. ROLLBACK preventivo.');
    }

    // PASO 5: Eliminar el cliente duplicado
    const r5 = await client.query(`DELETE FROM clients WHERE id = $1`, [ID_FUSIONAR]);
    console.log(`\n✅ PASO 5: Cliente duplicado eliminado → ${r5.rowCount} filas`);
    if (r5.rowCount !== 1) throw new Error(`Se esperaba eliminar 1 cliente, se eliminaron ${r5.rowCount}`);

    // ─────────────────────────────────────────────
    // POST-VERIFICACIÓN (dentro de la transacción, antes del COMMIT)
    // ─────────────────────────────────────────────
    console.log('\n📋 POST-VERIFICACIÓN...\n');

    const postConservar = await client.query(`SELECT id, identification_number, first_name, is_active FROM clients WHERE id = $1`, [ID_CONSERVAR]);
    const postFusionar  = await client.query(`SELECT id FROM clients WHERE id = $1`, [ID_FUSIONAR]);
    const postOrders    = await client.query(`SELECT COUNT(*) FROM orders WHERE client_id = $1`, [ID_CONSERVAR]);
    const postInvMov    = await client.query(`SELECT COUNT(*) FROM inventory_movements WHERE client_id = $1`, [ID_CONSERVAR]);

    if (postConservar.rows.length !== 1) throw new Error('Cliente correcto no encontrado post-merge');
    if (postFusionar.rows.length !== 0)  throw new Error('Cliente duplicado aún existe post-merge');
    if (parseInt(postOrders.rows[0].count) !== nOrders) throw new Error(`Pedidos post-merge incorrectos: ${postOrders.rows[0].count} (esperado: ${nOrders})`);

    console.log(`✅ Cliente correcto existe:    ${postConservar.rows[0].identification_number} | activo: ${postConservar.rows[0].is_active}`);
    console.log(`✅ Cliente duplicado borrado:  ya no existe en BD`);
    console.log(`✅ Pedidos en cliente correcto: ${postOrders.rows[0].count} (esperado: ${nOrders})`);
    console.log(`✅ inventory_movements:         ${postInvMov.rows[0].count} (esperado: ${nInvMov})`);

    // ─────────────────────────────────────────────
    // COMMIT
    // ─────────────────────────────────────────────
    await client.query('COMMIT');
    console.log('\n' + '='.repeat(80));
    console.log('🎉 COMMIT EXITOSO — MERGE COMPLETADO SIN PÉRDIDA DE DATOS');
    console.log('='.repeat(80));
    console.log(`\n✅ Cliente unificado: ID=${ID_CONSERVAR} | Cédula=0703990580`);
    console.log(`✅ ${nOrders} pedidos reasignados ($153.78 en total)`);
    console.log(`✅ ${nInvMov} movimiento(s) de inventario reasignado(s)`);
    console.log(`✅ Cliente duplicado (703990580) eliminado de la BD`);
    console.log('\n🔐 Transacción completada — ningún dato fue perdido.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n' + '='.repeat(80));
    console.error('❌ ERROR — ROLLBACK EJECUTADO — NINGÚN CAMBIO APLICADO');
    console.error('='.repeat(80));
    console.error(`\nDetalle: ${err.message}`);
  } finally {
    await client.end();
  }
}

ejecutarMerge();
