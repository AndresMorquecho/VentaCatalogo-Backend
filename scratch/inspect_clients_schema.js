/**
 * PASO PREVIO: Inspeccionar estructura real de la tabla clients
 * SOLO LECTURA
 */
const { Client } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const DB_URL = process.env.DATABASE_URL;

async function inspeccionar() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ Conectado\n');

  try {
    // Columnas de clients
    const cols = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients'
      ORDER BY ordinal_position
    `);
    console.log('=== COLUMNAS DE LA TABLA clients ===');
    cols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type} | nullable: ${r.is_nullable}`));

    // Todas las tablas
    const tablas = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log('\n=== TODAS LAS TABLAS ===');
    tablas.rows.forEach(r => console.log(`  ${r.table_name}`));

    // Primeras 3 filas de clients para ver la data real
    const muestra = await client.query(`SELECT * FROM clients LIMIT 3`);
    console.log('\n=== MUESTRA DE clients (3 filas) ===');
    muestra.rows.forEach((r, i) => {
      console.log(`\n-- Fila ${i+1} --`);
      Object.entries(r).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    });

    // Buscar Amanda por nombre
    const amanda = await client.query(`SELECT * FROM clients WHERE name ILIKE '%amanda%salvatierra%'`);
    console.log(`\n=== BÚSQUEDA AMANDA SALVATIERRA: ${amanda.rows.length} resultados ===`);
    amanda.rows.forEach((r, i) => {
      console.log(`\n-- Resultado ${i+1} --`);
      Object.entries(r).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    });

  } catch(e) {
    console.error('ERROR:', e.message);
  } finally {
    await client.end();
    console.log('\n✅ Cerrado - SIN CAMBIOS');
  }
}

inspeccionar();
