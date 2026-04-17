#!/usr/bin/env python3
"""
Inserta clientes únicos desde el Excel en la tabla clients.
Usa 'Identificación' como clave única (identification_number).

Uso: python scripts/excel_import/insert_clients.py
"""

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
EXCEL_FILE   = os.path.join(BASE_DIR, "EXCEL", "1111.xls")

def clean(val) -> str:
    if val is None:
        return ""
    if isinstance(val, float):
        import math
        if math.isnan(val):
            return ""
    return str(val).strip()

def main():
    print("=" * 60)
    print("   INSERTAR CLIENTES DESDE EXCEL → clients")
    print("=" * 60)

    df = pd.read_excel(EXCEL_FILE, sheet_name=0, engine="xlrd", dtype=str)
    df = df.where(pd.notna(df), None)

    # Extraer columnas relevantes y deduplicar por Identificación
    cols = ["Identificación", "Empresaria", "Teléfono 1", "Teléfono 2", "Teléfono 3"]
    sub = df[cols].copy()
    sub = sub.dropna(subset=["Identificación"])
    sub["Identificación"] = sub["Identificación"].str.strip()
    sub = sub.drop_duplicates(subset=["Identificación"])

    print(f"✅  {len(sub)} clientes únicos encontrados en el Excel")

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    now = datetime.datetime.now()

    inserted = 0
    skipped  = 0
    failed   = []

    with conn.cursor() as cur:
        for _, row in sub.iterrows():
            id_number = clean(row["Identificación"])
            if not id_number:
                continue

            # Verificar si ya existe
            cur.execute("SELECT id FROM clients WHERE identification_number = %s", (id_number,))
            if cur.fetchone():
                skipped += 1
                continue

            # Nombre completo desde columna Empresaria
            full_name = clean(row["Empresaria"]) or "SIN NOMBRE"

            phone1 = clean(row.get("Teléfono 1")) or "0000000000"
            phone2 = clean(row.get("Teléfono 2")) or None
            phone3 = clean(row.get("Teléfono 3")) or None

            client_id = str(uuid.uuid4())
            try:
                cur.execute("""
                    INSERT INTO clients (
                        id, identification_type, identification_number,
                        first_name, country, province, city, address,
                        email, phone1, operator1,
                        phone2, operator2,
                        updated_at
                    ) VALUES (
                        %s, 'CI', %s,
                        %s, 'EC', 'N/A', 'N/A', 'N/A',
                        %s, %s, 'N/A',
                        %s, %s,
                        %s
                    )
                """, (
                    client_id, id_number,
                    full_name,
                    f"{id_number}@importado.local",
                    phone1,
                    phone2, 'N/A' if phone2 else None,
                    now
                ))
                conn.commit()
                inserted += 1
            except Exception as e:
                conn.rollback()
                failed.append({"id_number": id_number, "error": str(e)})

    conn.close()

    print(f"\n  ✅ Insertados : {inserted}")
    print(f"  ⏭  Omitidos  : {skipped} (ya existían)")
    print(f"  ❌ Fallidos  : {len(failed)}")
    if failed:
        for f in failed:
            print(f"     • {f['id_number']} → {f['error']}")

if __name__ == "__main__":
    main()
