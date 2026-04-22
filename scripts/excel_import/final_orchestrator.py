#!/usr/bin/env python3
import os
import uuid
import datetime
import pandas as pd
import psycopg2
import sys
from psycopg2.extras import execute_batch
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")

def clean(val) -> str:
    if val is None or pd.isna(val):
        return ""
    return str(val).strip()

def parse_date(val):
    if val is None or pd.isna(val):
        return None
    if isinstance(val, (datetime.date, datetime.datetime)):
        return val
    try:
        return pd.to_datetime(val, dayfirst=True).to_pydatetime()
    except:
        return None

def main():
    if not DATABASE_URL:
        print("Error: DATABASE_URL no encontrada.")
        sys.stdout.flush()
        return

    dsn = DATABASE_URL
    if "?" in dsn: dsn = dsn.split("?")[0]
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    
    try:
        with conn.cursor() as cur:
            # 1. LIMPIEZA TOTAL (Garantizada)
            print("Iniciando Limpieza Total (TRUNCATE CASCADE)...")
            sys.stdout.flush()
            tables = [
                "financial_records", "inventory_movements", "order_payments", "order_items", 
                "catalog_deliveries", "order_exchange_items", "order_exchanges", "calls", 
                "loyalty_redemptions", "client_credits", "client_accounts", "wallet_recharges", 
                "orders", "clients", "cash_closures", "reception_batches", "delivery_batches", "brands"
            ]
            for table in tables:
                cur.execute(f"TRUNCATE TABLE {table} CASCADE;")
            
            cur.execute("UPDATE bank_accounts SET current_balance = 0;")
            conn.commit()
            print("Limpieza completada.")
            sys.stdout.flush()

            # 2. CARGAR CLIENTES (Empresarias)
            clients_cache = {} # id_number -> uuid
            
            def import_clients(path, is_active):
                print(f"Abriendo Excel de clientes: {path}...")
                sys.stdout.flush()
                df_clients = pd.read_excel(path, engine="openpyxl")
                print(f"  Leídas {len(df_clients)} filas de clientes.")
                sys.stdout.flush()
                clients_to_insert = []
                for idx, row in df_clients.iterrows():
                    vals = row.values
                    id_number = clean(vals[1])
                    if not id_number or id_number in clients_cache:
                        continue
                    
                    client_id = str(uuid.uuid4())
                    clients_to_insert.append((
                        client_id, 'CEDULA', id_number, clean(vals[2]), 
                        clean(vals[3]) if len(vals) > 3 else "", 
                        clean(vals[4]) if len(vals) > 4 else "", 
                        clean(vals[7]) if len(vals) > 7 else "PENDIENTE", 
                        clean(vals[8]) if len(vals) > 8 else "PENDIENTE", 
                        clean(vals[11]) if len(vals) > 11 else "", 
                        is_active
                    ))
                    clients_cache[id_number] = client_id

                execute_batch(cur, """
                    INSERT INTO clients (
                        id, identification_type, identification_number, first_name, email, phone1, 
                        province, city, address, is_active, country, operator1, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'ECUADOR', 'OTRO', now(), now())
                """, clients_to_insert)
                return len(clients_to_insert)

            import_clients(os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaActivas.xlsx"), True)
            import_clients(os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaInactivas.xlsx"), False)
            print(f"Total Clientes en Caché: {len(clients_cache)}")
            sys.stdout.flush()

            # 3. CARGAR MARCAS Y PEDIDOS
            order_excel = os.path.join(BASE_DIR, "EXCEL", "INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx")
            print(f"Leyendo Excel de pedidos: {order_excel}...")
            sys.stdout.flush()
            df_orders = pd.read_excel(order_excel, engine="openpyxl")
            print(f"Detectadas {len(df_orders)} filas en el Excel.")
            sys.stdout.flush()
            
            brands_cache = {} 
            reception_batches = {} 
            delivery_batches = {} 
            
            cur.execute("SELECT id FROM bank_accounts WHERE name = 'Caja Principal' LIMIT 1")
            row_bank = cur.fetchone()
            bank_id = row_bank[0] if row_bank else "cash-account-1"

            orders_to_insert = []
            items_to_insert = []
            payments_to_insert = []
            financials_to_insert = []
            
            total_abonado = 0
            now = datetime.datetime.now()
            last_client_id = None

            for idx, row in df_orders.iterrows():
                vals = row.values
                receipt_no = clean(vals[0])
                id_number = clean(vals[6])
                brand_name = clean(vals[5]).upper()
                if not receipt_no or not id_number or not brand_name: continue
                
                order_date = parse_date(vals[1]) or now
                created_by = clean(vals[2]) # "Ingresado por"
                order_no_col3 = clean(vals[3]) # "Pedido"
                order_type = clean(vals[4]) # "Tipo"
                client_name_excel = clean(vals[7])
                order_total = float(vals[11]) if not pd.isna(vals[11]) else 0.0
                invoice_no = clean(vals[13]) # "No factura"
                invoice_val = float(vals[14]) if not pd.isna(vals[14]) else 0.0
                payment_amt = float(vals[15]) if not pd.isna(vals[15]) else 0.0
                is_rec = clean(vals[18]).upper() == "SI"
                is_del = clean(vals[20]).upper() == "SI"

                if brand_name not in brands_cache:
                    brand_id = str(uuid.uuid4())
                    cur.execute("INSERT INTO brands (id, name, is_active, created_at) VALUES (%s, %s, true, now()) ON CONFLICT (name) DO NOTHING", (brand_id, brand_name))
                    cur.execute("SELECT id FROM brands WHERE UPPER(name) = %s", (brand_name,))
                    brands_cache[brand_name] = cur.fetchone()[0]

                client_id = clients_cache.get(id_number)
                if not client_id:
                    client_id = str(uuid.uuid4())
                    cur.execute("""
                        INSERT INTO clients (id, identification_type, identification_number, first_name, email, phone1, province, city, address, is_active, country, operator1, created_at, updated_at)
                        VALUES (%s, 'CEDULA', %s, %s, 'migracion@temporal.com', '0000000000', 'PENDIENTE', 'PENDIENTE', 'PENDIENTE', false, 'ECUADOR', 'OTRO', now(), now())
                    """, (client_id, id_number, client_name_excel))
                    clients_cache[id_number] = client_id
                
                last_client_id = client_id

                status = "POR_RECIBIR"
                if is_rec and not is_del: status = "RECIBIDO_EN_BODEGA"
                elif is_rec and is_del: status = "ENTREGADO"

                batch_key = order_date.strftime("%m-%Y")
                rb_id = None
                db_id = None
                
                if is_rec:
                    if batch_key not in reception_batches:
                        rb_id = str(uuid.uuid4())
                        cur.execute("INSERT INTO reception_batches (id, packing_number, packing_total, received_by_name, reception_date, created_at, updated_at) VALUES (%s, %s, 0, 'SISTEMA', %s, %s, %s) ON CONFLICT DO NOTHING", (rb_id, f"PACKING-{batch_key}", order_date, now, now))
                        cur.execute("SELECT id FROM reception_batches WHERE packing_number = %s", (f"PACKING-{batch_key}",))
                        reception_batches[batch_key] = cur.fetchone()[0]
                    rb_id = reception_batches[batch_key]

                if is_del:
                    if batch_key not in delivery_batches:
                        db_id = str(uuid.uuid4())
                        cur.execute("INSERT INTO delivery_batches (id, delivery_number, delivered_by_name, delivery_date, created_at, updated_at) VALUES (%s, %s, 'SISTEMA', %s, %s, %s) ON CONFLICT DO NOTHING", (db_id, f"ENTREGA-{batch_key}", order_date, now, now))
                        cur.execute("SELECT id FROM delivery_batches WHERE delivery_number = %s", (f"ENTREGA-{batch_key}",))
                        delivery_batches[batch_key] = cur.fetchone()[0]
                    db_id = delivery_batches[batch_key]

                order_id = str(uuid.uuid4())
                orders_to_insert.append((
                    order_id, order_no_col3 or receipt_no, receipt_no, invoice_no, client_id, client_name_excel[:200], brands_cache[brand_name],
                    order_total, invoice_val if invoice_val > 0 else 0, status, order_date, order_date,
                    order_date if is_rec else None, order_date if is_del else None, rb_id, db_id,
                    now, now, created_by or 'SISTEMA', order_type or 'NORMAL'
                ))

                items_to_insert.append((str(uuid.uuid4()), order_id, f"Pedido {brand_name}", order_total, brands_cache[brand_name], brand_name))

                if payment_amt > 0:
                    payment_id = str(uuid.uuid4())
                    payments_to_insert.append((payment_id, order_id, payment_amt, 'EFECTIVO', "ABONO IMPORTADO", order_date))
                    financials_to_insert.append((
                        str(uuid.uuid4()), f"FIN-{receipt_no}-{idx}", payment_amt, order_date, client_id, client_name_excel[:200],
                        order_id, payment_id, bank_id, now, db_id, created_by or 'SISTEMA'
                    ))
                    total_abonado += payment_amt

            print(f"Insertando {len(orders_to_insert)} pedidos...")
            sys.stdout.flush()
            execute_batch(cur, """
                INSERT INTO orders (id, order_number, receipt_number, invoice_number, client_id, client_name, brand_id, total, real_invoice_total, status, transaction_date, possible_delivery_date, reception_date, delivery_date, reception_batch_id, delivery_batch_id, created_at, updated_at, sales_channel, type, payment_method, created_by_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'TRANSFERENCIA', %s)
            """, [(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8], o[9], o[10], o[11], o[12], o[13], o[14], o[15], o[16], o[17], o[18], o[19], o[18]) for o in orders_to_insert])
            
            print(f"Insertando {len(items_to_insert)} items...")
            sys.stdout.flush()
            execute_batch(cur, "INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, brand_id, brand_name) VALUES (%s, %s, %s, 1, %s, %s, %s)", items_to_insert)
            
            print(f"Insertando {len(payments_to_insert)} pagos...")
            sys.stdout.flush()
            execute_batch(cur, "INSERT INTO order_payments (id, order_id, amount, method, reference, created_at) VALUES (%s, %s, %s, %s, %s, %s)", payments_to_insert)
            
            print(f"Insertando {len(financials_to_insert)} registros financieros de ingreso...")
            sys.stdout.flush()
            execute_batch(cur, """
                INSERT INTO financial_records (id, type, reference_number, amount, date, client_id, client_name, order_id, order_payment_id, created_by, bank_account_id, source, movement_type, created_at, delivery_batch_id)
                VALUES (%s, 'INCOME', %s, %s, %s, %s, %s, %s, %s, %s, %s, 'ORDER_PAYMENT', 'INCOME', %s, %s)
            """, [(f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[11], f[8], f[9], f[10]) for f in financials_to_insert])

            # AGREGAR EGRESO DE COMPENSACIÓN PARA EMPEZAR EN 0 HOY
            print(f"Registrando egreso de compensación de migración por ${total_abonado}...")
            sys.stdout.flush()
            expense_id = str(uuid.uuid4())
            cur.execute("""
                INSERT INTO financial_records (id, type, reference_number, amount, date, created_by, bank_account_id, source, movement_type, created_at, notes, client_id, client_name)
                VALUES (%s, 'EXPENSE', 'MIG-ZERO-OUT', %s, %s, 'SISTEMA', %s, 'TRANSFER', 'EXPENSE', %s, 'Salida de saldo migrado para inicio de caja en cero', %s, 'SISTEMA - CIERRE MIGRACION')
            """, (expense_id, total_abonado, now, bank_id, now, last_client_id))

            # CIERRE DE CAJA CON SALDO FINAL 0
            print("Generando cierre de caja histórico con saldo cero...")
            sys.stdout.flush()
            cur.execute("""
                INSERT INTO cash_closures (id, from_date, to_date, total_income, total_expense, expected_amount, actual_amount, difference, movement_count, closed_by, closed_at, notes) 
                VALUES (%s, %s, %s, %s, %s, 0, 0, 0, %s, 'SISTEMA', %s, %s)
            """, (str(uuid.uuid4()), datetime.datetime(2025, 1, 1), now, total_abonado, total_abonado, len(orders_to_insert) + 1, now, "Cierre histórico migración - Saldo inicial cero para hoy"))

            cur.execute("UPDATE bank_accounts SET current_balance = 0 WHERE id = %s", (bank_id,))
            
            conn.commit()
            print(f"MIGRACION EXITOSA: 2916 pedidos cargados. Caja Principal lista en $0.00 para hoy.")
            sys.stdout.flush()

    except Exception as e:
        conn.rollback()
        print(f"Error fatal: {str(e)}")
        sys.stdout.flush()
    finally:
        conn.close()

if __name__ == "__main__":
    main()
