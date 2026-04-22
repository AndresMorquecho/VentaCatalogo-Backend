#!/usr/bin/env python3
"""
MIGRACIÓN DEFINITIVA V3
=======================
Targets exactos:
  - Clientes: 2559 sin duplicados (169 activas, 2126 inactivas + extras de inventario)
  - Pedidos: 2916 (155 POR_RECIBIR, 587 RECIBIDO_EN_BODEGA, 2174 ENTREGADO)
  - Marcas: 19 únicas
  - Usuarios/Cajeras: 3
  - Reception batches: agrupados por MES/AÑO para los 587+2174 recibidos
  - Delivery batches: agrupados por MES/AÑO para los 2174 entregados
  - Abonos (caja): $29,454.64 en Caja Principal
  - Saldo pendiente: $62,369.40 distribuido en order_payments como saldo
  - Total pedidos: $92,297.23 / Valor factura: $87,721.56
"""

import os, uuid, datetime, math
from decimal import Decimal
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

# Contraseña por defecto para los usuarios cajeros: "1234"
# Hash bcrypt generado con cost=10
DEFAULT_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p368gdBfx6M4tDkCKBqR/O"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))
DATABASE_URL = os.getenv("DATABASE_URL")
DB_DSN = DATABASE_URL.split("?")[0] if DATABASE_URL and "?" in DATABASE_URL else DATABASE_URL

CASH_ACCOUNT_ID = "cash-account-1"

def clean(val) -> str:
    if val is None: return ""
    try:
        if pd.isna(val): return ""
    except: pass
    return str(val).strip()

def parse_date(val):
    if val is None: return None
    try:
        if pd.isna(val): return None
    except: pass
    if isinstance(val, (datetime.date, datetime.datetime)):
        if isinstance(val, datetime.date) and not isinstance(val, datetime.datetime):
            return datetime.datetime.combine(val, datetime.time.min)
        return val
    try:
        return pd.to_datetime(val, dayfirst=True).to_pydatetime()
    except:
        return None

def month_key(dt):
    """Retorna clave (año, mes) para agrupar batches."""
    if dt is None: return (2025, 1)
    if isinstance(dt, (datetime.date, datetime.datetime)):
        return (dt.year, dt.month)
    return (2025, 1)

def main():
    if not DB_DSN:
        print("ERROR: DATABASE_URL no encontrada.", flush=True)
        return

    conn = psycopg2.connect(DB_DSN)
    now = datetime.datetime.now()

    try:
        with conn.cursor() as cur:

            # =========================================================
            # PASO 0: LIMPIEZA TOTAL
            # =========================================================
            print("PASO 0: Limpiando base de datos...", flush=True)
            cur.execute("""
                TRUNCATE
                    catalog_deliveries, catalog_inventories,
                    delivery_batches, reception_batches,
                    order_payments, financial_records, cash_closures,
                    orders, order_receipts,
                    client_accounts, client_credits, clients,
                    brands, users
                RESTART IDENTITY CASCADE;
            """)
            conn.commit()
            print("  ✓ Base de datos limpia.", flush=True)

            # =========================================================
            # PASO 1: CARGAR CLIENTES (sin duplicados)
            # =========================================================
            print("PASO 1: Cargando clientes...", flush=True)
            clients_cache = {}   # id_number -> client_uuid
            active_ids = set()   # ids que vienen en activas

            # -- 1a. Activas (169 filas, header=0)
            df_a = pd.read_excel(os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaActivas.xlsx"), header=0)
            batch_c, batch_ac = [], []
            for _, row in df_a.iterrows():
                v = row.values
                id_num = clean(v[1])
                name   = clean(v[2])
                if not id_num or not name or id_num in clients_cache:
                    continue
                cid = str(uuid.uuid4())
                clients_cache[id_num] = cid
                active_ids.add(id_num)
                batch_c.append((
                    cid, 'CEDULA', id_num, name[:200],
                    'EC',
                    clean(v[7])[:100] or 'DESCONOCIDA',   # provincia
                    clean(v[8])[:100] or 'DESCONOCIDA',   # ciudad
                    clean(v[11])[:300] or 'DIRECCION PENDIENTE',  # direccion
                    clean(v[4])[:20] or '0000000000',     # telefono
                    True,   # is_active
                    now,    # last_data_update (activa = actualizada hoy)
                    now, now,
                    'N/A',
                    f"{id_num}@pendiente.com"
                ))
                batch_ac.append((str(uuid.uuid4()), cid, 'BRONCE', now, now))

            execute_values(cur, """
                INSERT INTO clients
                  (id, identification_type, identification_number, first_name,
                   country, province, city, address, phone1,
                   is_active, last_data_update, created_at, updated_at, operator1, email)
                VALUES %s
            """, batch_c)
            execute_values(cur, """
                INSERT INTO client_accounts (id, client_id, reward_level, created_at, updated_at)
                VALUES %s
            """, batch_ac)
            print(f"  ✓ {len(batch_c)} activas cargadas.", flush=True)

            # -- 1b. Inactivas (2126, header=1 porque fila 0 es plantilla)
            df_i = pd.read_excel(os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaInactivas.xlsx"), header=1)
            batch_c, batch_ac = [], []
            OUTDATED = datetime.datetime(2000, 1, 1)
            for _, row in df_i.iterrows():
                v = row.values
                id_num = clean(v[1])
                name   = clean(v[2])
                if not id_num or not name or id_num in clients_cache:
                    continue
                cid = str(uuid.uuid4())
                clients_cache[id_num] = cid
                batch_c.append((
                    cid, 'CEDULA', id_num, name[:200],
                    'EC',
                    clean(v[7])[:100] or 'DESCONOCIDA',
                    clean(v[8])[:100] or 'DESCONOCIDA',
                    clean(v[11])[:300] or 'DIRECCION PENDIENTE',
                    clean(v[4])[:20] or '0000000000',
                    False,     # is_active = False para inactivas
                    OUTDATED,  # last_data_update = 2000 → "actualizar datos"
                    now, now,
                    'N/A',
                    f"{id_num}@pendiente.com"
                ))
                batch_ac.append((str(uuid.uuid4()), cid, 'BRONCE', now, now))

            execute_values(cur, """
                INSERT INTO clients
                  (id, identification_type, identification_number, first_name,
                   country, province, city, address, phone1,
                   is_active, last_data_update, created_at, updated_at, operator1, email)
                VALUES %s
            """, batch_c)
            execute_values(cur, """
                INSERT INTO client_accounts (id, client_id, reward_level, created_at, updated_at)
                VALUES %s
            """, batch_ac)
            print(f"  ✓ {len(batch_c)} inactivas cargadas.", flush=True)
            conn.commit()

            # =========================================================
            # PASO 2: CARGAR INVENTARIO
            # =========================================================
            print("PASO 2: Leyendo inventario...", flush=True)
            df_inv = pd.read_excel(os.path.join(BASE_DIR, "EXCEL", "INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx"))
            # Columnas verificadas:
            # 0:No de recibo  1:Emisión     2:Ingresado por  3:Pedido  4:Tipo
            # 5:Catálogo(marca) 6:Identificación 7:Empresaria  8:Tel1
            # 11:Valor pedido  13:No factura   14:Valor factura  15:Abono  16:Saldo
            # 17:Ingreso el    18:Recibido(SI/NO)  19:Entregado el  20:Entregado(SI/NO)
            # 22:Recibo de entrega

            # =========================================================
            # PASO 3: USUARIOS / CAJERAS (3 únicos)
            # =========================================================
            print("PASO 3: Creando usuarios...", flush=True)
            users_cache = {}  # nombre_completo -> username
            batch_u = []
            seen_usernames = set()
            for val in df_inv.iloc[:, 2].dropna().unique():
                user_name = clean(val)
                if not user_name or user_name in users_cache:
                    continue
                uname = user_name.replace(" ", "_").lower()[:30]
                # Asegurar unicidad
                base = uname
                idx = 1
                while uname in seen_usernames:
                    uname = f"{base}_{idx}"
                    idx += 1
                seen_usernames.add(uname)
                uid = str(uuid.uuid4())
                users_cache[user_name] = {'id': uid, 'username': uname}
                batch_u.append((uid, uname, DEFAULT_PASSWORD_HASH, 'CAJERA', True, now, now))

            if batch_u:
                execute_values(cur, """
                    INSERT INTO users (id, username, password, role, is_active, created_at, updated_at)
                    VALUES %s ON CONFLICT (username) DO NOTHING
                """, batch_u)
            print(f"  ✓ {len(batch_u)} usuarios creados.", flush=True)

            # =========================================================
            # PASO 4: MARCAS (19 únicas)
            # =========================================================
            print("PASO 4: Creando marcas...", flush=True)
            brands_cache = {}  # nombre_upper -> brand_uuid
            batch_b = []
            for val in df_inv.iloc[:, 5].dropna().unique():
                brand = clean(val).upper()
                if not brand or brand in brands_cache:
                    continue
                bid = str(uuid.uuid4())
                brands_cache[brand] = bid
                batch_b.append((bid, brand, f"Marca importada: {brand}", True, now))

            if batch_b:
                execute_values(cur, """
                    INSERT INTO brands (id, name, description, is_active, created_at)
                    VALUES %s ON CONFLICT (name) DO NOTHING
                """, batch_b)
                # Re-sincronizar IDs reales (por si ON CONFLICT hubo duplicados previos)
                cur.execute("SELECT id, name FROM brands")
                brands_cache = {row[1].upper(): row[0] for row in cur.fetchall()}
            print(f"  ✓ {len(brands_cache)} marcas disponibles.", flush=True)
            conn.commit()

            # =========================================================
            # PASO 5: PROCESAR PEDIDOS Y CONSTRUIR BATCHES
            # =========================================================
            print("PASO 5: Procesando pedidos...", flush=True)

            # Batches agrupados por (año, mes)
            # reception_batches: para pedidos con Recibido=SI (587 + 2174)
            # delivery_batches:  para pedidos con Entregado=SI (2174)
            reception_batch_map = {}  # (year, month) -> batch_uuid
            delivery_batch_map  = {}  # (year, month) -> batch_uuid
            rb_data = []  # datos para bulk insert de reception_batches
            db_data = []  # datos para bulk insert de delivery_batches

            latest_activity = {}  # client_id -> {'date': dt, 'brand': str}

            orders_data    = []
            payments_data  = []
            financial_data = []

            total_abonos = Decimal('0')
            missing_clients_batch_c  = []
            missing_clients_batch_ac = []

            for idx, row in df_inv.iterrows():
                v = row.values
                brand_name = clean(v[5]).upper()
                id_num     = clean(v[6])
                if not id_num or not brand_name:
                    continue

                brand_id = brands_cache.get(brand_name)
                if not brand_id:
                    continue

                # --- Auto-crear cliente si falta ---
                cid = clients_cache.get(id_num)
                if not cid:
                    cid = str(uuid.uuid4())
                    clients_cache[id_num] = cid
                    client_name_inv = clean(v[7])[:200] or 'DESCONOCIDA'
                    missing_clients_batch_c.append((
                        cid, 'CEDULA', id_num, client_name_inv,
                        'EC', 'DESCONOCIDA', 'DESCONOCIDA', 'DIRECCION PENDIENTE',
                        clean(v[8])[:20] or '0000000000',
                        True, OUTDATED, now, now, 'N/A', f"{id_num}@pendiente.com"
                    ))
                    missing_clients_batch_ac.append((str(uuid.uuid4()), cid, 'BRONCE', now, now))

                # --- Estado del pedido ---
                rec = clean(v[18]).upper()
                ent = clean(v[20]).upper()
                is_received = (rec == 'SI')
                is_delivered = (ent == 'SI')

                status = 'POR_RECIBIR'
                if is_delivered:
                    status = 'ENTREGADO'
                elif is_received:
                    status = 'RECIBIDO_EN_BODEGA'

                order_date    = parse_date(v[1])
                ingreso_date  = parse_date(v[17])   # Fecha que llegó a bodega
                entrega_date  = parse_date(v[19])   # Fecha de entrega al cliente
                possible_date = parse_date(v[12])

                # --- Batches de recepción (Recibido=SI) ---
                rb_id = None
                if is_received:
                    mk = month_key(ingreso_date or order_date)
                    if mk not in reception_batch_map:
                        rb_uuid = str(uuid.uuid4())
                        reception_batch_map[mk] = rb_uuid
                        pack_num = f"PKG-{mk[0]}-{mk[1]:02d}"
                        rb_data.append((rb_uuid, pack_num, 0, now, 'SISTEMA', None, now, now))
                    rb_id = reception_batch_map[mk]

                # --- Batches de entrega (Entregado=SI) ---
                db_id = None
                if is_delivered:
                    mk = month_key(entrega_date or order_date)
                    if mk not in delivery_batch_map:
                        db_uuid = str(uuid.uuid4())
                        delivery_batch_map[mk] = db_uuid
                        del_num = f"DEL-{mk[0]}-{mk[1]:02d}"
                        db_data.append((db_uuid, del_num, entrega_date or now, 'SISTEMA', None, now, now))
                    db_id = delivery_batch_map[mk]

                # --- Valores ---
                val_pedido   = float(v[11]) if not pd.isna(v[11]) else 0.0
                val_factura  = float(v[14]) if not pd.isna(v[14]) else 0.0
                abono        = Decimal(str(v[15])).quantize(Decimal('0.01')) if not pd.isna(v[15]) else Decimal('0')
                saldo        = float(v[16]) if not pd.isna(v[16]) else 0.0
                total_order  = val_factura if val_factura > 0 else val_pedido

                receipt_no   = clean(v[0])           # col[0]  = "No de recibo"
                order_num    = clean(v[3])            # col[3]  = "Pedido" (descripción del pedido)
                recibo_entrega = clean(v[22])         # col[22] = "Recibo de entrega"
                invoice_no   = clean(v[13])
                ingresado_por = clean(v[2])
                client_name  = clean(v[7])[:200]

                # --- Pedido ---
                oid = str(uuid.uuid4())
                orders_data.append((
                    oid,
                    order_num,        # order_number
                    receipt_no,       # receipt_number
                    'CATALOGO',       # sales_channel
                    'REGULAR',        # type
                    brand_id,
                    total_order,      # total
                    val_factura if val_factura > 0 else None,  # real_invoice_total
                    'EFECTIVO',       # payment_method
                    order_date or now,
                    possible_date or order_date or now,
                    ingreso_date,     # reception_date
                    entrega_date,     # delivery_date
                    invoice_no or None,
                    status,
                    cid,
                    client_name,
                    now, now,
                    1,               # version
                    ingresado_por,   # created_by_name
                    rb_id,           # reception_batch_id
                    db_id,           # delivery_batch_id
                    'FACTURA',       # document_type
                ))

                # --- Abono (pago real) ---
                pid = None
                if abono != Decimal('0'):
                    pid = str(uuid.uuid4())
                    payments_data.append((
                        pid, oid, float(abono), 'EFECTIVO',
                        'ABONO INVENTARIO MIGRADO', now,
                        receipt_no, False
                    ))
                    financial_data.append((
                        str(uuid.uuid4()),
                        'INGRESO',
                        f"MIG-{receipt_no}-{pid[:6]}",
                        float(abono),
                        order_date or now,
                        cid, client_name,
                        oid,
                        ingresado_por or 'SISTEMA',
                        CASH_ACCOUNT_ID,
                        'PEDIDO',
                        'EFECTIVO',
                        'INGRESO',
                        now,
                        1,
                        pid,
                        False,  # is_reversal
                    ))
                    total_abonos += abono  # Decimal arithmetic, no float drift

                # --- Saldo pendiente (si tiene saldo) registrarlo como pago pendiente ---
                # El saldo queda registrado en el campo de la orden; no generamos
                # un payment adicional para no distorsionar la caja.
                # El módulo de cartera usa orders.total - sum(order_payments.amount)

                # --- Actividad para last_order_date de activas ---
                if id_num in active_ids and order_date:
                    if cid not in latest_activity or order_date > latest_activity[cid]['date']:
                        latest_activity[cid] = {'date': order_date, 'brand': brand_name}

            # Insertar clientes auto-creados del inventario
            if missing_clients_batch_c:
                execute_values(cur, """
                    INSERT INTO clients
                      (id, identification_type, identification_number, first_name,
                       country, province, city, address, phone1,
                       is_active, last_data_update, created_at, updated_at, operator1, email)
                    VALUES %s ON CONFLICT (identification_number) DO NOTHING
                """, missing_clients_batch_c)
                execute_values(cur, """
                    INSERT INTO client_accounts (id, client_id, reward_level, created_at, updated_at)
                    VALUES %s ON CONFLICT (client_id) DO NOTHING
                """, missing_clients_batch_ac)
                print(f"  ✓ {len(missing_clients_batch_c)} clientes extras del inventario creados.", flush=True)

            # =========================================================
            # PASO 6: INSERT MASIVO — Batches
            # =========================================================
            print("PASO 6: Insertando batches de recepción y entrega...", flush=True)
            if rb_data:
                execute_values(cur, """
                    INSERT INTO reception_batches
                      (id, packing_number, packing_total, reception_date,
                       received_by_name, notes, created_at, updated_at)
                    VALUES %s
                """, rb_data)
            if db_data:
                execute_values(cur, """
                    INSERT INTO delivery_batches
                      (id, delivery_number, delivery_date,
                       delivered_by_name, notes, created_at, updated_at)
                    VALUES %s
                """, db_data)
            print(f"  ✓ {len(rb_data)} reception batches, {len(db_data)} delivery batches.", flush=True)

            # =========================================================
            # PASO 7: INSERT MASIVO — Pedidos
            # =========================================================
            print("PASO 7: Insertando pedidos...", flush=True)
            execute_values(cur, """
                INSERT INTO orders
                  (id, order_number, receipt_number, sales_channel, type, brand_id,
                   total, real_invoice_total, payment_method,
                   transaction_date, possible_delivery_date, reception_date, delivery_date,
                   invoice_number, status, client_id, client_name,
                   created_at, updated_at, version, created_by_name,
                   reception_batch_id, delivery_batch_id, document_type)
                VALUES %s
            """, orders_data)
            print(f"  ✓ {len(orders_data)} pedidos insertados.", flush=True)

            # =========================================================
            # PASO 8: INSERT MASIVO — Pagos y Finanzas
            # =========================================================
            print("PASO 8: Insertando pagos y registros financieros...", flush=True)
            if payments_data:
                execute_values(cur, """
                    INSERT INTO order_payments
                      (id, order_id, amount, method, reference, created_at,
                       receipt_number, is_adjustment)
                    VALUES %s
                """, payments_data)
            if financial_data:
                execute_values(cur, """
                    INSERT INTO financial_records
                      (id, type, reference_number, amount, date,
                       client_id, client_name, order_id,
                       created_by, bank_account_id, source, payment_method,
                       movement_type, created_at, version, order_payment_id, is_reversal)
                    VALUES %s
                    ON CONFLICT (reference_number) DO UPDATE SET 
                        reference_number = EXCLUDED.reference_number || '-' || floor(random()*1000)::text
                """, financial_data)
            print(f"  ✓ {len(payments_data)} abonos, {len(financial_data)} registros financieros.", flush=True)

            # =========================================================
            # PASO 9: ACTUALIZAR SALDO CAJA Y ACTIVIDAD DE CLIENTES
            # =========================================================
            print("PASO 9: Actualizando saldo de caja y actividad de clientes...", flush=True)
            total_abonos_round = float(total_abonos)  # Already exact via Decimal
            cur.execute("""
                UPDATE bank_accounts
                SET current_balance = %s, updated_at = %s
                WHERE id = %s
            """, (total_abonos_round, now, CASH_ACCOUNT_ID))

            # Actualizar last_order_date y last_brand_name solo para activas
            for cid, act in latest_activity.items():
                cur.execute("""
                    UPDATE clients
                    SET last_order_date = %s, last_brand_name = %s
                    WHERE id = %s
                """, (act['date'], act['brand'], cid))
            print(f"  ✓ Saldo caja: ${total_abonos_round:,.2f} | {len(latest_activity)} clientes con última actividad.", flush=True)

            # =========================================================
            # PASO 10: CIERRE DE CAJA HISTÓRICO
            # =========================================================
            print("PASO 10: Creando cierre de caja histórico...", flush=True)
            closure_id = str(uuid.uuid4())
            start_date = datetime.datetime(2025, 1, 1)
            cur.execute("""
                INSERT INTO cash_closures
                  (id, from_date, to_date, notes, total_income, total_expense,
                   expected_amount, actual_amount, difference,
                   movement_count, closed_by, closed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                closure_id, start_date, now,
                'Cierre historico - Migracion de inventario',
                total_abonos_round, 0,
                total_abonos_round, total_abonos_round, 0,
                len(payments_data),
                'SISTEMA',
                now
            ))
            print(f"  ✓ Cierre de caja creado.", flush=True)

            conn.commit()

            # =========================================================
            # RESUMEN FINAL
            # =========================================================
            print("", flush=True)
            print("=" * 60, flush=True)
            print("MIGRACIÓN COMPLETADA EXITOSAMENTE", flush=True)
            print("=" * 60, flush=True)
            cur.execute("SELECT COUNT(*) FROM clients WHERE is_active = true")
            c_act = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM clients WHERE is_active = false")
            c_ina = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM clients")
            c_tot = cur.fetchone()[0]
            cur.execute("SELECT status, COUNT(*) FROM orders GROUP BY status")
            status_counts = {r[0]: r[1] for r in cur.fetchall()}
            cur.execute("SELECT COUNT(*) FROM brands")
            b_tot = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM users")
            u_tot = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM reception_batches")
            rb_tot = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM delivery_batches")
            db_tot = cur.fetchone()[0]
            cur.execute("SELECT SUM(amount) FROM order_payments")
            pay_tot = cur.fetchone()[0] or 0

            print(f"Clientes totales:   {c_tot}  (Activas: {c_act}, Inactivas: {c_ina})", flush=True)
            print(f"Pedidos totales:    {len(orders_data)}", flush=True)
            for s, n in sorted(status_counts.items()):
                print(f"  - {s}: {n}", flush=True)
            print(f"Marcas:            {b_tot}", flush=True)
            print(f"Usuarios:          {u_tot}", flush=True)
            print(f"Reception batches: {rb_tot}", flush=True)
            print(f"Delivery batches:  {db_tot}", flush=True)
            print(f"Abonos (caja):     ${pay_tot:,.2f}", flush=True)
            print("=" * 60, flush=True)

    except Exception as e:
        conn.rollback()
        import traceback
        print(f"ERROR FATAL: {e}", flush=True)
        traceback.print_exc()
    finally:
        conn.close()

if __name__ == "__main__":
    main()
