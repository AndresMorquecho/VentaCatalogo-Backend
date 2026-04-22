#!/usr/bin/env python3
import os
import uuid
import datetime
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
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
    if not DATABASE_URL: return
    dsn = DATABASE_URL.split("?")[0] if "?" in DATABASE_URL else DATABASE_URL
    conn = psycopg2.connect(dsn)
    now = datetime.datetime.now()
    
    try:
        with conn.cursor() as cur:
            print("--- PASO 0: LIMPIEZA TOTAL ---", flush=True)
            cur.execute("TRUNCATE order_payments, financial_records, orders, client_accounts, clients, brands, users RESTART IDENTITY CASCADE;")
            
            # --- PASO 1: CLIENTES ---
            print("--- PASO 1: CARGA RÁPIDA DE CLIENTES ---", flush=True)
            clients_cache = {}
            
            def load_clients_batch(path, is_active):
                df = pd.read_excel(path, header=(1 if "Inactivas" in path else 0))
                last_update = now if is_active else datetime.datetime(2000, 1, 1)
                batch_clients = []
                batch_accounts = []
                for _, row in df.iterrows():
                    v = row.values
                    id_num, name = clean(v[1]), clean(v[2])
                    if not id_num or not name: continue
                    if id_num in clients_cache: continue
                    cid = str(uuid.uuid4())
                    clients_cache[id_num] = cid
                    batch_clients.append((cid, 'CEDULA', id_num, name[:200], 'EC', clean(v[7])[:100], clean(v[8])[:100], clean(v[11])[:200], clean(v[4])[:50], is_active, last_update, now, now, 'N/A', f"{id_num}@pendiente.com"))
                    batch_accounts.append((str(uuid.uuid4()), cid, 'BRONCE', now, now))
                
                execute_values(cur, "INSERT INTO clients (id, identification_type, identification_number, first_name, country, province, city, address, phone1, is_active, last_data_update, created_at, updated_at, operator1, email) VALUES %s", batch_clients)
                execute_values(cur, "INSERT INTO client_accounts (id, client_id, reward_level, created_at, updated_at) VALUES %s", batch_accounts)

            load_clients_batch(os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaActivas.xlsx"), True)
            load_clients_batch(os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaInactivas.xlsx"), False)

            # --- PASO 2: INVENTARIO ---
            print("--- PASO 2: CARGA RÁPIDA DE INVENTARIO ---", flush=True)
            df_inv = pd.read_excel(os.path.join(BASE_DIR, "EXCEL", "INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx"))
            
            brands_cache = {}
            users_cache = {}
            orders_data = []
            payments_data = []
            financial_data = []
            latest_act = {}
            total_abonos = 0.0

            for idx, row in df_inv.iterrows():
                v = row.values
                brand_name = clean(v[5]).upper()
                id_num = clean(v[6])
                if not id_num or not brand_name: continue

                # Usuario
                user_name = clean(v[2])
                if user_name and user_name not in users_cache:
                    uid, uname = str(uuid.uuid4()), user_name.replace(" ","_").lower()[:20]
                    cur.execute("INSERT INTO users (id, username, password, role, is_active, created_at, updated_at) VALUES (%s,%s,%s,'CAJERA',true,%s,%s) ON CONFLICT DO NOTHING", (uid, uname, DEFAULT_PASSWORD_HASH, now, now))
                    users_cache[user_name] = uname

                # Marca
                if brand_name not in brands_cache:
                    bid = str(uuid.uuid4())
                    cur.execute("INSERT INTO brands (id, name, is_active, created_at) VALUES (%s,%s,true,%s) ON CONFLICT (name) DO NOTHING", (bid, brand_name, now))
                    cur.execute("SELECT id FROM brands WHERE name = %s", (brand_name,))
                    brands_cache[brand_name] = cur.fetchone()[0]

                # Cliente Auto-creado
                cid = clients_cache.get(id_num)
                if not cid:
                    cid = str(uuid.uuid4())
                    cur.execute("INSERT INTO clients (id, identification_type, identification_number, first_name, country, province, city, address, is_active, last_data_update, phone1, created_at, updated_at, operator1, email) VALUES (%s,'CEDULA',%s,%s,'EC','DESCONOCIDA','DESCONOCIDA','DIRECCION PENDIENTE',true,'2000-01-01','0000000000',%s,%s,'N/A',%s)", (cid, id_num, clean(v[7])[:200], now, now, f"{id_num}@pendiente.com"))
                    cur.execute("INSERT INTO client_accounts (id, client_id, reward_level, created_at, updated_at) VALUES (%s,%s,'BRONCE',%s,%s)", (str(uuid.uuid4()), cid, now, now))
                    clients_cache[id_num] = cid

                # LÓGICA DE ESTADOS CORREGIDA
                # 18: Recibido (SI/NO), 20: Entregado (SI/NO)
                is_received = clean(v[18]).upper() == "SI"
                is_delivered = clean(v[20]).upper() == "SI"
                status = "POR_RECIBIR"
                if is_delivered: status = "ENTREGADO"
                elif is_received: status = "RECIBIDO_EN_BODEGA"

                # Pedido
                oid = str(uuid.uuid4())
                order_date = parse_date(v[1])
                order_num = clean(v[22]) if clean(v[22]) else clean(v[0])
                total_val = float(v[14]) if not pd.isna(v[14]) and float(v[14]) > 0 else float(v[11]) if not pd.isna(v[11]) else 0.0
                orders_data.append((oid, order_num, clean(v[0]), cid, clean(v[7])[:200], brands_cache[brand_name], total_val, status, order_date or now, order_date or now, parse_date(v[19]), now, now, 'CATALOGO', 'REGULAR', 'EFECTIVO', 1, user_name, 'FACTURA'))

                # Abonos
                amt = float(v[15]) if not pd.isna(v[15]) else 0.0
                if amt > 0:
                    pid = str(uuid.uuid4())
                    payments_data.append((pid, oid, amt, 'EFECTIVO', 'ABONO INVENTARIO', order_date or now))
                    financial_data.append((str(uuid.uuid4()), 'INGRESO', f"REC-{clean(v[0])}-{idx}", amt, order_date or now, cid, clean(v[7])[:200], oid, user_name or 'SISTEMA', 'cash-account-1', 'PEDIDO', 'EFECTIVO', 'INGRESO', order_date or now, pid))
                    total_abonos += amt

                if order_date:
                    if cid not in latest_act or order_date > latest_act[cid]['date']: latest_act[cid] = {'date': order_date, 'brand': brand_name}

            # Inserts Masivos
            execute_values(cur, "INSERT INTO orders (id, order_number, receipt_number, client_id, client_name, brand_id, total, status, transaction_date, possible_delivery_date, delivery_date, created_at, updated_at, sales_channel, type, payment_method, version, created_by_name, document_type) VALUES %s", orders_data)
            execute_values(cur, "INSERT INTO order_payments (id, order_id, amount, method, reference, created_at) VALUES %s", payments_data)
            execute_values(cur, "INSERT INTO financial_records (id, type, reference_number, amount, date, client_id, client_name, order_id, created_by, bank_account_id, source, payment_method, movement_type, created_at, order_payment_id) VALUES %s", financial_data)

            # Paso 3: Sincronización y Saldo Final
            print(f"--- PASO 3: ACTUALIZANDO SALDO DE CAJA Y ACTIVIDAD ---", flush=True)
            cur.execute("UPDATE bank_accounts SET current_balance = %s WHERE id = 'cash-account-1'", (round(total_abonos, 2),))
            for cid, act in latest_act.items():
                cur.execute("UPDATE clients SET last_order_date = %s, last_brand_name = %s WHERE id = %s", (act['date'], act['brand'], cid))
            
            conn.commit()
            print(f"MIGRACIÓN EXITOSA. Total Abonos: ${total_abonos:.2f} | Pedidos: {len(orders_data)}", flush=True)

    except Exception as e:
        conn.rollback()
        print(f"ERROR: {str(e)}", flush=True)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
