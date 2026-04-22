#!/usr/bin/env python3
import os
import uuid
import datetime
import pandas as pd
import psycopg2
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
        # Intentar parsear formato DD/MM/YYYY o similar
        return pd.to_datetime(val, dayfirst=True).to_pydatetime()
    except:
        return None

def main():
    if not DATABASE_URL:
        print("Error: DATABASE_URL no encontrada.")
        return

    dsn = DATABASE_URL
    if "?" in dsn: dsn = dsn.split("?")[0]
    conn = psycopg2.connect(dsn)
    
    excel_path = os.path.join(BASE_DIR, "EXCEL", "INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx")
    print(f"Leyendo Excel: {excel_path}...")
    
    # Cargar todo el Excel
    df = pd.read_excel(excel_path, engine="openpyxl")
    
    now = datetime.datetime.now()
    orders_imported = 0
    payments_imported = 0
    brands_created = 0
    
    # Diccionarios para caché y tracking
    brands_cache = {} # name -> id
    clients_cache = {} # identification -> id
    latest_activity = {} # client_id -> {date, brand_name}

    try:
        with conn.cursor() as cur:
            # 1. Precargar Clientes existentes para vinculación rápida
            print("Cargando caché de clientes...")
            cur.execute("SELECT id, identification_number FROM clients")
            for row in cur.fetchall():
                clients_cache[row[1]] = row[0]

            # 2. Precargar Marcas existentes
            print("Cargando caché de marcas...")
            cur.execute("SELECT id, name FROM brands")
            for row in cur.fetchall():
                brands_cache[row[1].upper()] = row[0]

            print(f"Procesando {len(df)} filas...")
        with conn.cursor() as cur:
            # Step 0: Clean previous imports to avoid duplication
            print("Cleaning previous imports...")
            # We also include common creators to be sure we don't duplicate from previous runs
            creators = list(df.iloc[:, 2].dropna().unique())
            creators_list = ", ".join([f"'{c}'" for c in creators])
            import_channels = f"('CATALOGO', 'IMPORTADO', {creators_list})"
            
            cur.execute(f"DELETE FROM financial_records WHERE order_id IN (SELECT id FROM orders WHERE sales_channel IN {import_channels})")
            cur.execute(f"DELETE FROM inventory_movements WHERE order_id IN (SELECT id FROM orders WHERE sales_channel IN {import_channels})")
            cur.execute(f"DELETE FROM order_payments WHERE order_id IN (SELECT id FROM orders WHERE sales_channel IN {import_channels})")
            cur.execute(f"DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE sales_channel IN {import_channels})")
            cur.execute(f"DELETE FROM orders WHERE sales_channel IN {import_channels}")
            print(f"Deleted {cur.rowcount} previous orders and their dependencies.")
            conn.commit()

            errors = []
            for idx, row in df.iterrows():
                vals = row.values
                receipt_no = clean(vals[0])
                order_date = parse_date(vals[1])
                created_by = clean(vals[2])
                order_no_col3 = clean(vals[3])
                brand_name = clean(vals[5]).upper()
                id_number = clean(vals[6])
                order_total = float(vals[11]) if not pd.isna(vals[11]) else 0.0
                invoice_no = clean(vals[13])
                invoice_val = float(vals[14]) if not pd.isna(vals[14]) else 0.0
                payment_amt = float(vals[15]) if not pd.isna(vals[15]) else 0.0
                is_received = clean(vals[18]).upper() == "SI"
                delivery_date = parse_date(vals[18]) # original placeholder
                is_delivered = clean(vals[20]).upper() == "SI"
                delivery_receipt = clean(vals[22]) 

                if not id_number or not brand_name:
                    continue

                if idx % 100 == 0:
                    print(f"Procesando fila {idx}...")
                
                try:
                    cur.execute("SAVEPOINT row_save")
                    
                    # A. Cliente
                    client_id = clients_cache.get(id_number)
                    client_name_excel = clean(vals[7])
                    if not client_id:
                        client_id = str(uuid.uuid4())
                        cur.execute("""
                            INSERT INTO clients (
                                id, identification_type, identification_number, first_name,
                                country, province, city, address, is_active, 
                                last_data_update, phone1, created_at, updated_at,
                                operator1, email
                            ) VALUES (%s, 'CEDULA', %s, %s, 'EC', 'DESCONOCIDA', 'DESCONOCIDA', 'DIRECCION PENDIENTE', true, '2000-01-01', %s, %s, %s, 'N/A', %s)
                            ON CONFLICT (identification_number) DO NOTHING
                        """, (client_id, id_number, client_name_excel[:200], clean(vals[8])[:20] or "0000000000", now, now, f"{id_number}@pendiente.com"))
                        
                        cur.execute("SELECT id FROM clients WHERE identification_number = %s", (id_number,))
                        client_id = cur.fetchone()[0]
                        clients_cache[id_number] = client_id
                        
                        cur.execute("INSERT INTO client_accounts (id, client_id, reward_level, created_at, updated_at) VALUES (%s, %s, 'BRONCE', %s, %s) ON CONFLICT (client_id) DO NOTHING",
                                    (str(uuid.uuid4()), client_id, now, now))

                    # B. Marca
                    brand_id = brands_cache.get(brand_name)
                    if not brand_id:
                        brand_id = str(uuid.uuid4())
                        cur.execute("INSERT INTO brands (id, name, description, is_active, created_at) VALUES (%s, %s, %s, true, %s) ON CONFLICT (name) DO NOTHING",
                                    (brand_id, brand_name, f"Marca importada: {brand_name}", now))
                        cur.execute("SELECT id FROM brands WHERE name = %s", (brand_name,))
                        brand_id = cur.fetchone()[0]
                        brands_cache[brand_name] = brand_id
                        brands_created += 1

                    # C. Pedido
                    status = "POR_RECIBIR"
                    if is_delivered: status = "ENTREGADO"
                    elif is_received: status = "RECIBIDO_EN_BODEGA"
                    
                    order_id = str(uuid.uuid4())
                    final_order_number = order_no_col3 if order_no_col3 else (delivery_receipt if delivery_receipt else receipt_no)
                    cur.execute("""
                        INSERT INTO orders (
                            id, order_number, receipt_number, invoice_number, 
                            client_id, client_name, brand_id, total, real_invoice_total, status,
                            transaction_date, possible_delivery_date, delivery_date,
                            created_at, updated_at, sales_channel, type, payment_method, version,
                            created_by_name
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'REGULAR', 'TRANSFERENCIA', 1, %s)
                    """, (
                        order_id, final_order_number, receipt_no, invoice_no,
                        client_id, client_name_excel[:200], brand_id, order_total, invoice_val if invoice_val > 0 else None, status,
                        order_date or now, order_date or now, delivery_date, now, now,
                        created_by if created_by else 'CATALOGO',
                        created_by if created_by else 'SISTEMA'
                    ))
                    orders_imported += 1

                    # D. Pago
                    if payment_amt > 0:
                        cur.execute("""
                            INSERT INTO order_payments (id, order_id, amount, method, reference, created_at)
                            VALUES (%s, %s, %s, 'TRANSFERENCIA', %s, %s)
                        """, (str(uuid.uuid4()), order_id, payment_amt, f"ABONO IMPORTADO - {order_date.strftime('%d/%m/%Y') if order_date else ''}", order_date or now))
                        payments_imported += 1

                    if order_date:
                        if client_id not in latest_activity or order_date > latest_activity[client_id]['date']:
                            latest_activity[client_id] = {'date': order_date, 'brand': brand_name}
                    
                    cur.execute("RELEASE SAVEPOINT row_save")
                except Exception as e:
                    cur.execute("ROLLBACK TO SAVEPOINT row_save")
                    errors.append(f"Fila {idx}: {str(e)}")

                if orders_imported % 50 == 0:
                    conn.commit()
                    print(f"  Procesados {orders_imported} pedidos...")

            # 3. Actualizar Clientes con su última actividad
            print("Actualizando información de última actividad en clientes...")
            updated_clients = 0
            for cid, activity in latest_activity.items():
                cur.execute("""
                    UPDATE clients 
                    SET last_order_date = %s, last_brand_name = %s 
                    WHERE id = %s
                """, (activity['date'], activity['brand'], cid))
                updated_clients += 1
            
            conn.commit()
            print(f"Finalizado: {orders_imported} pedidos, {payments_imported} abonos, {brands_created} marcas, {updated_clients} clientes actualizados.")

    except Exception as e:
        conn.rollback()
        print(f"Error fatal durante la importación: {str(e)}")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
