#!/usr/bin/env python3
import os
import uuid
import datetime
import pandas as pd
import psycopg2
from dotenv import load_dotenv

DEFAULT_PASSWORD_HASH = "$2b$10$n7/M/8.8G1M9m2K2U8uSdubyMh.h8h8h8h8h8h8h8h8h8h8h8"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")

def clean(val) -> str:
    if val is None or pd.isna(val): return ""
    return str(val).strip()

def parse_date(val):
    if val is None or pd.isna(val): return None
    if isinstance(val, (datetime.date, datetime.datetime)): return val
    try: return pd.to_datetime(val, dayfirst=True).to_pydatetime()
    except: return None

def main():
    if not DATABASE_URL:
        print("Error: DATABASE_URL no encontrada.", flush=True)
        return

    dsn = DATABASE_URL
    if "?" in dsn: dsn = dsn.split("?")[0]
    conn = psycopg2.connect(dsn)
    now = datetime.datetime.now()
    
    try:
        with conn.cursor() as cur:
            print("--- PASO 0: LIMPIEZA DE BASE DE DATOS ---", flush=True)
            cur.execute("TRUNCATE order_payments, financial_records, orders, client_accounts, clients, brands, users RESTART IDENTITY CASCADE;")
            conn.commit()

            clients_cache = {} # identification -> id
            
            # --- PASO 1: IMPORTAR EMPRESARIAS (ACTIVAS/INACTIVAS) ---
            print("--- PASO 1: IMPORTANDO EMPRESARIAS ---", flush=True)
            
            def import_clients(path, is_active):
                print(f"  Procesando {os.path.basename(path)}...", flush=True)
                header_row = 1 if "Inactivas" in path else 0
                df_c = pd.read_excel(path, header=header_row)
                last_update_date = now if is_active else datetime.datetime(2000, 1, 1)
                
                count = 0
                for _, row in df_c.iterrows():
                    vals = row.values
                    id_number = clean(vals[1])
                    full_name = clean(vals[2])
                    if not id_number or not full_name: continue
                    
                    cid = str(uuid.uuid4())
                    cur.execute("""
                        INSERT INTO clients (
                            id, identification_type, identification_number, first_name,
                            country, province, city, address, phone1, is_active, 
                            last_data_update, created_at, updated_at, operator1, email
                        ) VALUES (%s, 'CEDULA', %s, %s, 'EC', %s, %s, %s, %s, %s, %s, %s, %s, 'N/A', %s)
                        ON CONFLICT (identification_number) DO NOTHING
                    """, (cid, id_number, full_name, clean(vals[7]), clean(vals[8]), clean(vals[11]), clean(vals[4]), is_active, last_update_date, now, now, f"{id_number}@pendiente.com"))
                    
                    if cur.rowcount > 0:
                        cur.execute("INSERT INTO client_accounts (id, client_id, reward_level, created_at, updated_at) VALUES (%s, %s, 'BRONCE', %s, %s) ON CONFLICT (client_id) DO NOTHING",
                                    (str(uuid.uuid4()), cid, now, now))
                        clients_cache[id_number] = cid
                    
                    count += 1
                    if count % 100 == 0:
                        conn.commit()
                        print(f"    - {count} empresarias procesadas...", flush=True)
                conn.commit()

            import_clients(os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaActivas.xlsx"), True)
            import_clients(os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaInactivas.xlsx"), False)

            # --- PASO 2: IMPORTAR INVENTARIO (PEDIDOS, PAGOS, USUARIOS) ---
            print("--- PASO 2: IMPORTANDO INVENTARIO Y FINANZAS ---", flush=True)
            inv_path = os.path.join(BASE_DIR, "EXCEL", "INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx")
            df_inv = pd.read_excel(inv_path)
            
            brands_cache = {}
            users_cache = {}
            latest_activity = {}
            total_orders = 0
            total_payments = 0
            
            # Precargar marcas existentes
            cur.execute("SELECT id, name FROM brands")
            for r in cur.fetchall(): brands_cache[r[1].upper()] = r[0]

            for idx, row in df_inv.iterrows():
                vals = row.values
                receipt_no = clean(vals[0])
                order_date = parse_date(vals[1])
                ingresado_por = clean(vals[2])
                brand_name = clean(vals[5]).upper()
                id_number = clean(vals[6])
                client_name = clean(vals[7])
                order_total = float(vals[11]) if not pd.isna(vals[11]) else 0.0
                invoice_val = float(vals[14]) if not pd.isna(vals[14]) else 0.0
                payment_amt = float(vals[15]) if not pd.isna(vals[15]) else 0.0
                is_received = clean(vals[17]).upper() == "SI"
                delivery_date = parse_date(vals[18])
                is_delivered = clean(vals[19]).upper() == "SI"
                delivery_receipt = clean(vals[22])

                if not id_number or not brand_name: continue

                try:
                    cur.execute("SAVEPOINT sp_row")
                    # Usuario
                    if ingresado_por and ingresado_por not in users_cache:
                        username = ingresado_por.replace(" ", "_").lower()[:20]
                        cur.execute("INSERT INTO users (id, username, password, role, is_active, created_at, updated_at) VALUES (%s, %s, %s, 'CAJERA', true, %s, %s) ON CONFLICT (username) DO NOTHING",
                                    (str(uuid.uuid4()), username, DEFAULT_PASSWORD_HASH, now, now))
                        users_cache[ingresado_por] = username

                    # Marca
                    if brand_name not in brands_cache:
                        bid = str(uuid.uuid4())
                        cur.execute("INSERT INTO brands (id, name, is_active, created_at) VALUES (%s, %s, true, %s) ON CONFLICT (name) DO NOTHING", (bid, brand_name, now))
                        cur.execute("SELECT id FROM brands WHERE name = %s", (brand_name,))
                        brands_cache[brand_name] = cur.fetchone()[0]
                    
                    brand_id = brands_cache[brand_name]

                    # Cliente
                    cid = clients_cache.get(id_number)
                    if not cid:
                        cid = str(uuid.uuid4())
                        cur.execute("""
                            INSERT INTO clients (id, identification_type, identification_number, first_name, country, province, city, address, is_active, last_data_update, phone1, created_at, updated_at, operator1, email)
                            VALUES (%s, 'CEDULA', %s, %s, 'EC', 'DESCONOCIDA', 'DESCONOCIDA', 'DIRECCION PENDIENTE', true, '2000-01-01', %s, %s, %s, 'N/A', %s)
                            ON CONFLICT (identification_number) DO NOTHING
                        """, (cid, id_number, client_name[:200], clean(vals[8])[:20] or "0000000000", now, now, f"{id_number}@pendiente.com"))
                        cur.execute("SELECT id FROM clients WHERE identification_number = %s", (id_number,))
                        cid = cur.fetchone()[0]
                        cur.execute("INSERT INTO client_accounts (id, client_id, reward_level, created_at, updated_at) VALUES (%s, %s, 'BRONCE', %s, %s) ON CONFLICT (client_id) DO NOTHING",
                                    (str(uuid.uuid4()), cid, now, now))
                        clients_cache[id_number] = cid

                    # Estado
                    status = "POR_RECIBIR"
                    if is_delivered: status = "ENTREGADO"
                    elif is_received: status = "RECIBIDO_EN_BODEGA"

                    # Pedido
                    oid = str(uuid.uuid4())
                    cur.execute("""
                        INSERT INTO orders (
                            id, order_number, receipt_number, client_id, client_name, brand_id, total, status,
                            transaction_date, possible_delivery_date, delivery_date, created_at, updated_at,
                            sales_channel, type, payment_method, version, created_by_name, document_type
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'CATALOGO', 'REGULAR', 'EFECTIVO', 1, %s, 'FACTURA')
                    """, (oid, delivery_receipt if delivery_receipt else receipt_no, receipt_no, cid, client_name[:200], brand_id, 
                          invoice_val if invoice_val > 0 else order_total, status, order_date or now, order_date or now, delivery_date, now, now, ingresado_por))
                    total_orders += 1

                    # Pago y Caja
                    if payment_amt > 0:
                        pid = str(uuid.uuid4())
                        cur.execute("INSERT INTO order_payments (id, order_id, amount, method, reference, created_at) VALUES (%s, %s, %s, 'EFECTIVO', 'ABONO INVENTARIO', %s)", (pid, oid, payment_amt, order_date or now))
                        cur.execute("""
                            INSERT INTO financial_records (
                                id, type, reference_number, amount, date, client_id, client_name, order_id,
                                created_by, bank_account_id, source, payment_method, movement_type, created_at, order_payment_id
                            ) VALUES (%s, 'INGRESO', %s, %s, %s, %s, %s, %s, %s, 'cash-account-1', 'PEDIDO', 'EFECTIVO', 'INGRESO', %s, %s)
                        """, (str(uuid.uuid4()), f"REC-{receipt_no}-{idx}", payment_amt, order_date or now, cid, client_name[:200], oid, ingresado_por or 'SISTEMA', order_date or now, pid))
                        total_payments += 1

                    if order_date:
                        if cid not in latest_activity or order_date > latest_activity[cid]['date']:
                            latest_activity[cid] = {'date': order_date, 'brand': brand_name}

                    cur.execute("RELEASE SAVEPOINT sp_row")
                except Exception as row_e:
                    cur.execute("ROLLBACK TO SAVEPOINT sp_row")
                    print(f"Error en pedido {idx}: {str(row_e)}", flush=True)

                if total_orders % 100 == 0:
                    conn.commit()
                    print(f"  Procesados {total_orders} pedidos...", flush=True)

            # --- PASO 3: ACTUALIZAR ACTIVIDAD FINAL ---
            print("--- PASO 3: ACTUALIZANDO ACTIVIDAD DE CLIENTES ---", flush=True)
            for cid, activity in latest_activity.items():
                cur.execute("UPDATE clients SET last_order_date = %s, last_brand_name = %s WHERE id = %s", (activity['date'], activity['brand'], cid))
            
            conn.commit()
            print(f"MIGRACIÓN COMPLETADA EXITOSAMENTE.", flush=True)
            print(f"Pedidos: {total_orders} | Pagos: {total_payments} | Clientes: {len(clients_cache)}", flush=True)

    except Exception as e:
        conn.rollback()
        print(f"ERROR EN LA MIGRACIÓN: {str(e)}", flush=True)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
