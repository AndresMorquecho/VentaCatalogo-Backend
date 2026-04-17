#!/usr/bin/env python3
"""
Elimina todos los datos insertados por los scripts de importación.
Uso: python scripts/excel_import/rollback.py
"""

import os
import sys
import pandas as pd
import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
EXCEL_FILE   = os.path.join(BASE_DIR, "EXCEL", "1111.xls")

def main():
    print("=" * 60)
    print("   ROLLBACK - ELIMINAR DATOS IMPORTADOS")
    print("=" * 60)

    confirm = input("\n⚠️  ¿Estás seguro? Esto eliminará todos los datos importados. (s/n): ").strip().lower()
    if confirm != "s":
        print("Operación cancelada.")
        sys.exit(0)

    # Leer Excel para saber qué eliminar
    df = pd.read_excel(EXCEL_FILE, sheet_name=0, engine="xlrd", dtype=str)
    df = df.where(pd.notna(df), None)

    receipt_numbers = df["No de recibo"].dropna().str.strip().unique().tolist()

    id_numbers = df["Identificación"].dropna().str.strip().unique().tolist()
    id_numbers.append("IMPORTADO")

    catalogs = df["Catálogo"].dropna().str.strip().unique().tolist()
    catalogs.append("IMPORTADO")

    usernames = set()
    for col in ["Ingresado por", "Usuario entrego"]:
        if col in df.columns:
            vals = df[col].dropna().str.strip()
            usernames.update(vals.unique())
    usernames = ["_".join(n.lower().split()) for n in usernames]

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    with conn.cursor() as cur:

        # 1. Order items (dependen de orders)
        cur.execute("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE sales_channel = 'IMPORTADO')")
        print(f"  ✔  order_items eliminados : {cur.rowcount}")

        # 2. Órdenes
        cur.execute("DELETE FROM orders WHERE sales_channel = 'IMPORTADO'")
        print(f"  ✔  orders eliminados      : {cur.rowcount}")

        # 3. Clientes (por cédula del Excel + IMPORTADO)
        cur.execute("DELETE FROM clients WHERE identification_number = ANY(%s)", (id_numbers,))
        print(f"  ✔  clients eliminados     : {cur.rowcount}")

        # 4. Marcas (por nombre del Excel + IMPORTADO)
        cur.execute("DELETE FROM brands WHERE name = ANY(%s)", (catalogs,))
        print(f"  ✔  brands eliminados      : {cur.rowcount}")

        # 5. Usuarios (por username generado)
        cur.execute("DELETE FROM users WHERE username = ANY(%s)", (usernames,))
        print(f"  ✔  users eliminados       : {cur.rowcount}")

    conn.commit()
    conn.close()

    print("\n✅  Rollback completado.")

if __name__ == "__main__":
    main()
