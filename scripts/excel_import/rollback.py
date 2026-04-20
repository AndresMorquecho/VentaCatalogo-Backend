#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Elimina todos los datos insertados por los scripts de importacion.
Uso: python scripts/excel_import/rollback.py
"""

import os
import sys
import pandas as pd
import psycopg2
from dotenv import load_dotenv

# Fix encoding for Windows terminals
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
EXCEL_FILE   = os.path.join(BASE_DIR, "EXCEL", "1111.xls")

def main():
    print("=" * 60)
    print("   ROLLBACK - ELIMINAR DATOS IMPORTADOS")
    print("=" * 60)

    confirm = input("\nATENCION: Esto eliminara todos los datos importados. Continuar? (s/n): ").strip().lower()
    if confirm != "s":
        print("Operacion cancelada.")
        sys.exit(0)

    # Leer Excel para saber que eliminar
    df = pd.read_excel(EXCEL_FILE, sheet_name=0, engine="xlrd", dtype=str)
    df = df.where(pd.notna(df), None)

    id_numbers = df["Identificacion" if "Identificacion" in df.columns else "Identificación"].dropna().str.strip().unique().tolist()
    id_numbers.append("IMPORTADO")

    catalogs_col = "Catalogo" if "Catalogo" in df.columns else "Catálogo"
    catalogs = df[catalogs_col].dropna().str.strip().unique().tolist() if catalogs_col in df.columns else []
    catalogs.append("IMPORTADO")

    usernames = set()
    for col in ["Ingresado por", "Usuario entrego"]:
        if col in df.columns:
            vals = df[col].dropna().str.strip()
            usernames.update(vals.unique())
    usernames_list = ["_".join(n.lower().split()) for n in usernames]

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    with conn.cursor() as cur:

        # 1. financial_records vinculados a ordenes importadas
        cur.execute("""
            DELETE FROM financial_records
            WHERE order_id IN (SELECT id FROM orders WHERE sales_channel = 'IMPORTADO')
        """)
        print(f"  OK  financial_records eliminados : {cur.rowcount}")

        # 2. order_payments vinculados a ordenes importadas
        cur.execute("""
            DELETE FROM order_payments
            WHERE order_id IN (SELECT id FROM orders WHERE sales_channel = 'IMPORTADO')
        """)
        print(f"  OK  order_payments eliminados    : {cur.rowcount}")

        # 3. order_items (dependen de orders)
        cur.execute("""
            DELETE FROM order_items
            WHERE order_id IN (SELECT id FROM orders WHERE sales_channel = 'IMPORTADO')
        """)
        print(f"  OK  order_items eliminados       : {cur.rowcount}")

        # 3b. inventory_movements vinculados a ordenes importadas (FK constraint)
        cur.execute("""
            DELETE FROM inventory_movements
            WHERE order_id IN (SELECT id FROM orders WHERE sales_channel = 'IMPORTADO')
        """)
        print(f"  OK  inventory_movements eliminados: {cur.rowcount}")

        # 4. Ordenes
        cur.execute("DELETE FROM orders WHERE sales_channel = 'IMPORTADO'")
        print(f"  OK  orders eliminados            : {cur.rowcount}")

        # 5. client_accounts vinculados a clientes importados
        cur.execute("DELETE FROM client_accounts WHERE client_id IN (SELECT id FROM clients WHERE identification_number = ANY(%s))", (id_numbers,))
        print(f"  OK  client_accounts eliminados   : {cur.rowcount}")

        # 6. Clientes (por cedula del Excel + IMPORTADO)
        cur.execute("DELETE FROM clients WHERE identification_number = ANY(%s)", (id_numbers,))
        print(f"  OK  clients eliminados           : {cur.rowcount}")

        # 7. Marcas (por nombre del Excel + IMPORTADO)
        cur.execute("DELETE FROM brands WHERE name = ANY(%s)", (catalogs,))
        print(f"  OK  brands eliminados            : {cur.rowcount}")

        # 8. Usuarios (por username generado)
        if usernames_list:
            cur.execute("DELETE FROM users WHERE username = ANY(%s)", (usernames_list,))
            print(f"  OK  users eliminados             : {cur.rowcount}")

    conn.commit()
    conn.close()

    print("\n[OK] Rollback completado.")

if __name__ == "__main__":
    main()
