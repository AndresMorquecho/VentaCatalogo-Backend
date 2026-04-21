#!/usr/bin/env python3
import os
import sys
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
        return pd.to_datetime(val).to_pydatetime()
    except:
        return None

def migrate_file(path, is_active, conn):
    print(f"\nProcesando: {os.path.basename(path)} (Estado Activo: {is_active})")
    
    # Inactivas tiene una fila vacia al inicio (header en row 1)
    header_row = 1 if "Inactivas" in path else 0
    df = pd.read_excel(path, sheet_name=0, engine="openpyxl", header=header_row)
    
    inserted = 0
    skipped = 0
    errors = []
    
    now = datetime.datetime.now()
    # Fecha antigua para marcar como "Pendiente de actualizar"
    pending_update_date = datetime.datetime(2000, 1, 1)

    with conn.cursor() as cur:
        for idx, row in df.iterrows():
            # Mapeo por indices para evitar problemas con nombres de columnas largos/especiales
            # 0: Tipo ID, 1: Num ID, 2: Nombres, 3: Email, 4: Celular 1, 5: Operadora 1, 6: WhatsApp
            # 7: Provincia, 8: Ciudad, 9: Barrio, 10: Sector, 11: Direccion
            # 12: Celular 2, 13: Operadora 2, 14: Referencia, 15: Nacimiento, 16: Emision
            
            vals = row.values
            if len(vals) < 3: continue
            
            id_type = clean(vals[0]) or "CEDULA"
            id_number = clean(vals[1])
            full_name = clean(vals[2])
            
            if not id_number or not full_name:
                continue

            client_id = str(uuid.uuid4())
            email = clean(vals[3]) or f"{id_number}@pendiente.com"
            phone1 = clean(vals[4]) or "0000000000"
            operator1 = clean(vals[5]) or "N/A"
            is_whatsapp = True if clean(vals[6]).upper() == "SI" else False
            
            province = clean(vals[7]) or "N/A"
            city = clean(vals[8]) or "N/A"
            neighborhood = clean(vals[9]) or None
            sector = clean(vals[10]) or None
            address = clean(vals[11]) or "N/A"
            
            phone2 = clean(vals[12]) or None
            operator2 = clean(vals[13]) or None
            reference = clean(vals[14]) or None
            
            birth_date = parse_date(vals[15])
            issuance_date = parse_date(vals[16])

            last_update = now if is_active else pending_update_date

            try:
                # 1. Insertar o Actualizar Cliente (UPSERT)
                cur.execute("""
                    INSERT INTO clients (
                        id, identification_type, identification_number, first_name,
                        country, province, city, address, neighborhood, sector,
                        email, phone1, operator1, phone2, operator2, reference,
                        is_active, is_whatsapp, last_data_update,
                        birth_date, identification_issuance_date,
                        created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s,
                        'EC', %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s,
                        %s, %s
                    )
                    ON CONFLICT (identification_number) DO UPDATE SET
                        first_name = EXCLUDED.first_name,
                        is_active = EXCLUDED.is_active,
                        last_data_update = EXCLUDED.last_data_update,
                        updated_at = EXCLUDED.updated_at
                    RETURNING id
                """, (
                    client_id, id_type, id_number, full_name,
                    province, city, address, neighborhood, sector,
                    email, phone1, operator1, phone2, operator2, reference,
                    is_active, is_whatsapp, last_update,
                    birth_date, issuance_date,
                    now, now
                ))
                
                # Obtener el ID (ya sea el nuevo o el existente)
                real_client_id = cur.fetchone()[0]

                # 2. Crear Cuenta de Cliente (ClientAccount) si no existe
                account_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO client_accounts (
                        id, client_id, total_credit_available, total_reward_points,
                        total_orders, total_spent, reward_level, created_at, updated_at
                    ) VALUES (
                        %s, %s, 0, 0, 0, 0, 'BRONCE', %s, %s
                    ) ON CONFLICT (client_id) DO NOTHING
                """, (account_id, real_client_id, now, now))

                inserted += 1
                if inserted % 50 == 0:
                    conn.commit() # Commit parcial cada 50
            except Exception as e:
                conn.rollback()
                errors.append(f"Error en fila {idx} (ID: {id_number}): {str(e)}")

        conn.commit()
    
    print(f"  OK Insertados : {inserted}")
    print(f"  SKIP Omitidos   : {skipped}")
    if errors:
        print(f"  ERR Errores    : {len(errors)}")
        for err in errors[:5]: print(f"     - {err}")

def main():
    if not DATABASE_URL:
        print("❌ Error: DATABASE_URL no encontrada.")
        return

    # Clean DATABASE_URL for psycopg2 (strip Prisma params like connection_limit)
    dsn = DATABASE_URL
    if "?" in dsn:
        dsn = dsn.split("?")[0]
    
    conn = psycopg2.connect(dsn)
    
    try:
        activas_path = os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaActivas.xlsx")
        inactivas_path = os.path.join(BASE_DIR, "EXCEL", "FormatoEmpresariaInactivas.xlsx")
        
        migrate_file(activas_path, True, conn)
        migrate_file(inactivas_path, False, conn)
        
    finally:
        conn.close()
    
    print("\nMigracion finalizada.")

if __name__ == "__main__":
    main()
