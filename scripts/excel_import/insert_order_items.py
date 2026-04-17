#!/usr/bin/env python3
"""
Inserta order_items desde el Excel.
Columna 'Pedido' → product_name
Columna 'Tipo'   → status
Columna 'Valor pedido' → unit_price
Columna 'Posible entrega' → possible_delivery_date
Columna 'Catálogo' → brand (lookup)

Requiere que las órdenes ya existan en la tabla orders (importadas previamente).
Usa 'Recibo de entrega' para encontrar la orden correspondiente por receipt_number.

Uso: python scripts/excel_import/insert_order_items.py
"""

import os
import sys
import uuid
import datetime
from typing import Optional
import pandas as pd
import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
EXCEL_FILE   = os.path.join(BASE_DIR, "EXCEL", "1111.xls")

def clean(val) -> Optional[str]:
    if val is None:
        return None
    import math
    if isinstance(val, float) and math.isnan(val):
        return None
    s = str(val).strip()
    return s if s and s.lower() not in ("nan", "none") else None

def parse_date(val) -> Optional[datetime.date]:
    if val is None:
        return None
    if isinstance(val, (datetime.date, datetime.datetime)):
        return val.date() if isinstance(val, datetime.datetime) else val
    s = str(val).strip()
    if not s or s.lower() in ("nan", "none"):
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None

def parse_numeric(val) -> float:
    if val is None:
        return 0.0
    try:
        return float(str(val).replace(",", ".").strip())
    except Exception:
        return 0.0

def main():
    print("=" * 60)
    print("   INSERTAR ORDER ITEMS DESDE EXCEL → order_items")
    print("=" * 60)

    df = pd.read_excel(EXCEL_FILE, sheet_name=0, engine="xlrd", dtype=str)
    df = df.where(pd.notna(df), None)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    # Cache de brands y orders
    with conn.cursor() as cur:
        cur.execute("SELECT name, id FROM brands")
        brand_map = {r[0]: r[1] for r in cur.fetchall()}

        # Órdenes importadas: receipt_number → (order_id, brand_id)
        cur.execute("SELECT receipt_number, id, brand_id FROM orders WHERE sales_channel = 'IMPORTADO'")
        order_map = {}
        for r in cur.fetchall():
            order_map[str(r[0])] = {"order_id": r[1], "brand_id": r[2]}

    print(f"  Marcas en DB   : {len(brand_map)}")
    print(f"  Órdenes en DB  : {len(order_map)}")

    inserted = 0
    skipped  = 0
    failed   = []

    for idx, row in df.iterrows():
        product_name = clean(row.get("Pedido"))
        if not product_name:
            skipped += 1
            continue

        receipt_raw  = clean(row.get("Recibo de entrega"))
        catalog_name = clean(row.get("Catálogo"))
        tipo         = clean(row.get("Tipo")) or "NORMAL"
        unit_price   = parse_numeric(row.get("Valor pedido"))
        poss_date    = parse_date(row.get("Posible entrega"))

        # Buscar orden por No de recibo (receipt_number)
        receipt_no = clean(row.get("No de recibo"))
        order_info = order_map.get(str(receipt_no)) if receipt_no else None

        if not order_info:
            failed.append({
                "row": int(idx) + 2,
                "product": product_name,
                "error": f"No se encontró orden con No de recibo={receipt_no}"
            })
            continue

        order_id = order_info["order_id"]
        brand_id = brand_map.get(catalog_name) or order_info["brand_id"]
        brand_name = catalog_name or "IMPORTADO"

        item_id = str(uuid.uuid4())
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO order_items (
                        id, order_id, product_name, quantity,
                        unit_price, brand_id, brand_name,
                        possible_delivery_date, status
                    ) VALUES (%s, %s, %s, 1, %s, %s, %s, %s, %s)
                """, (
                    item_id, order_id, product_name,
                    unit_price, brand_id, brand_name,
                    poss_date, tipo
                ))
            conn.commit()
            inserted += 1
        except Exception as e:
            conn.rollback()
            failed.append({"row": int(idx) + 2, "product": product_name, "error": str(e)})

    conn.close()

    print(f"\n  ✅ Insertados : {inserted}")
    print(f"  ⏭  Omitidos  : {skipped}")
    print(f"  ❌ Fallidos  : {len(failed)}")
    if failed:
        for f in failed[:10]:
            print(f"     Fila #{f['row']} [{f['product']}] → {f['error']}")
        if len(failed) > 10:
            print(f"     ... y {len(failed)-10} más")

if __name__ == "__main__":
    main()
