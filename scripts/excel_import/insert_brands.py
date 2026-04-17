#!/usr/bin/env python3
"""
Inserta marcas únicas desde la columna 'Catálogo' del Excel en la tabla brands.

Uso: python scripts/excel_import/insert_brands.py
"""

import os
import sys
import uuid
import pandas as pd
import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
EXCEL_FILE   = os.path.join(BASE_DIR, "EXCEL", "1111.xls")

def main():
    print("=" * 60)
    print("   INSERTAR MARCAS DESDE EXCEL → brands")
    print("=" * 60)

    df = pd.read_excel(EXCEL_FILE, sheet_name=0, engine="xlrd", dtype=str)
    df = df.where(pd.notna(df), None)

    names = df["Catálogo"].dropna().str.strip().unique()
    names = [n for n in names if n]
    print(f"✅  {len(names)} marcas únicas: {names}")

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    inserted = 0
    skipped  = 0

    with conn.cursor() as cur:
        for name in sorted(names):
            cur.execute("SELECT id FROM brands WHERE name = %s", (name,))
            if cur.fetchone():
                print(f"  ⏭  Ya existe: {name}")
                skipped += 1
                continue

            brand_id = str(uuid.uuid4())
            cur.execute(
                "INSERT INTO brands (id, name) VALUES (%s, %s)",
                (brand_id, name)
            )
            conn.commit()
            print(f"  ✔  Creada: {name}  (id: {brand_id})")
            inserted += 1

    conn.close()

    print(f"\n  ✅ Insertadas : {inserted}")
    print(f"  ⏭  Omitidas  : {skipped} (ya existían)")

if __name__ == "__main__":
    main()
