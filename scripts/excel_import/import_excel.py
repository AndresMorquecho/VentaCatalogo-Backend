#!/usr/bin/env python3
"""
Inserta órdenes desde el Excel en la tabla orders.
Usa 'No de recibo' como receipt_number (clave única por fila).
Requiere que clients y brands ya estén insertados.

Mapeo de estado (columnas Excel → status en DB):
  Recibido=NO                        → POR_RECIBIR          (pendiente en módulo recepción)
  Recibido=SI, Entregado=NO o vacío  → RECIBIDO_EN_BODEGA   (en bodega, pendiente entrega)
  Recibido=SI, Entregado=SI          → ENTREGADO            (entregado al cliente)

Uso: python scripts/excel_import/import_excel.py
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
if not DATABASE_URL:
    print("❌  No se encontró DATABASE_URL en el .env")
    sys.exit(1)

EXCEL_FILE = os.path.join(BASE_DIR, "EXCEL", "1111.xls")


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
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
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


def parse_status(recibido_val, entregado_val) -> str:
    """
    Mapea las columnas 'Recibido' y 'Entregado' del Excel al status del sistema.

      Recibido=NO                         → POR_RECIBIR
      Recibido=SI  +  Entregado=NO/vacío  → RECIBIDO_EN_BODEGA
      Recibido=SI  +  Entregado=SI        → ENTREGADO
    """
    recibido  = str(recibido_val  or "").strip().upper()
    entregado = str(entregado_val or "").strip().upper()

    if recibido == "SI":
        if entregado == "SI":
            return "ENTREGADO"
        else:
            return "RECIBIDO_EN_BODEGA"
    else:
        return "POR_RECIBIR"


def main():
    print("=" * 60)
    print("   IMPORTAR ÓRDENES DESDE EXCEL → orders")
    print("=" * 60)
    print(f"\n📂  Leyendo {os.path.basename(EXCEL_FILE)}...")

    df = pd.read_excel(EXCEL_FILE, sheet_name=0, engine="xlrd", dtype=str)
    df = df.where(pd.notna(df), None)
    print(f"✅  {len(df)} filas | columnas: {list(df.columns)}")

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    now = datetime.datetime.now()

    # ── Cache brands y clients ────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("SELECT name, id FROM brands")
        brand_map = {r[0]: r[1] for r in cur.fetchall()}

        cur.execute("SELECT identification_number, id, first_name FROM clients")
        client_map = {r[0]: {"id": r[1], "name": r[2]} for r in cur.fetchall()}

        # Fallback genérico
        cur.execute("SELECT id FROM clients WHERE identification_number = 'IMPORTADO'")
        row = cur.fetchone()
        fallback_client_id = row[0] if row else None

        cur.execute("SELECT id FROM brands WHERE name = 'IMPORTADO'")
        row = cur.fetchone()
        fallback_brand_id = row[0] if row else None

    # Crear falbacks si no existen
    if not fallback_client_id:
        fallback_client_id = str(uuid.uuid4())
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO clients (id, identification_type, identification_number,
                    first_name, country, province, city, address,
                    email, phone1, operator1, updated_at)
                VALUES (%s,'CI','IMPORTADO','IMPORTADO','EC','N/A','N/A','N/A',
                    'importado@local.com','0000000000','N/A',%s)
            """, (fallback_client_id, now))
        conn.commit()

    if not fallback_brand_id:
        fallback_brand_id = str(uuid.uuid4())
        with conn.cursor() as cur:
            cur.execute("INSERT INTO brands (id, name) VALUES (%s, 'IMPORTADO')", (fallback_brand_id,))
        conn.commit()

    # ── Limpiar órdenes importadas anteriormente ─────────────────────────────
    print("\n🧹  Limpiando importación anterior (sales_channel='IMPORTADO')...")
    with conn.cursor() as cur:
        cur.execute("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE sales_channel = 'IMPORTADO')")
        cur.execute("DELETE FROM orders WHERE sales_channel = 'IMPORTADO'")
        deleted = cur.rowcount
    conn.commit()
    print(f"  ✔  {deleted} órdenes eliminadas")

    success = 0
    failed  = []

    # Contadores por status para resumen
    status_counts = {"POR_RECIBIR": 0, "RECIBIDO_EN_BODEGA": 0, "ENTREGADO": 0}

    print(f"\n⏳  Insertando {len(df)} órdenes...")

    for idx, row in df.iterrows():
        receipt_number = clean(row.get("No de recibo"))
        if not receipt_number:
            receipt_number = f"IMP-{str(uuid.uuid4())[:8]}"

        # ── Resolver cliente por Identificación ──────────────────────────────
        id_number   = clean(row.get("Identificación"))
        client_info = client_map.get(id_number) if id_number else None
        client_id   = client_info["id"]   if client_info else fallback_client_id
        client_name = client_info["name"] if client_info else clean(row.get("Empresaria")) or "IMPORTADO"

        # ── Resolver marca por Catálogo ──────────────────────────────────────
        catalog  = clean(row.get("Catálogo"))
        brand_id = brand_map.get(catalog) if catalog else None
        brand_id = brand_id or fallback_brand_id

        # ── Mapeo de estado correcto (clave de la migración) ─────────────────
        recibido_raw  = row.get("Recibido")
        entregado_raw = row.get("Entregado")
        status = parse_status(recibido_raw, entregado_raw)
        status_counts[status] = status_counts.get(status, 0) + 1

        # ── Fechas ───────────────────────────────────────────────────────────
        transaction_date       = parse_date(row.get("Ingreso el")) or datetime.date.today()
        possible_delivery_date = parse_date(row.get("Posible entrega")) or datetime.date.today()
        delivery_date_raw      = parse_date(row.get("Entregado el"))

        # reception_date: si está recibido en bodega o entregado, usamos la fecha de ingreso
        # (no existe columna "Fecha Recepción" en el Excel, así que usamos transaction_date)
        reception_date = transaction_date if status in ("RECIBIDO_EN_BODEGA", "ENTREGADO") else None

        # delivery_date: si está entregado usamos columna "Entregado el" o transaction_date como fallback
        delivery_date = None
        if status == "ENTREGADO":
            delivery_date = delivery_date_raw or transaction_date

        # ── Campos financieros ───────────────────────────────────────────────
        total              = parse_numeric(row.get("Valor factura")) or parse_numeric(row.get("Valor pedido"))
        real_invoice_total = parse_numeric(row.get("Abono")) or None
        credit_note_total  = parse_numeric(row.get("Saldo")) or None
        invoice_number     = clean(row.get("No factura"))

        # ── Campos de auditoría ──────────────────────────────────────────────
        delivered_by_name = clean(row.get("Usuario entrego"))
        created_by_name   = clean(row.get("Ingresado por"))
        tipo              = clean(row.get("Tipo")) or "NORMAL"
        # 'Recibo de entrega' es el N° de pedido real del catálogo (número de referencia)
        # 'Pedido' es el nombre del producto (va en order_items, no aquí)
        pedido_number     = clean(row.get("Recibo de entrega"))

        order_id = str(uuid.uuid4())
        data = {
            "id":                     order_id,
            "receipt_number":         receipt_number,
            "sales_channel":          "IMPORTADO",
            "type":                   tipo,
            "brand_id":               brand_id,
            "total":                  total,
            "real_invoice_total":     real_invoice_total,
            "payment_method":         "IMPORTADO",
            "transaction_date":       transaction_date,
            "possible_delivery_date": possible_delivery_date,
            "reception_date":         reception_date,
            "delivery_date":          delivery_date,
            "invoice_number":         invoice_number,
            "status":                 status,
            "client_id":              client_id,
            "client_name":            client_name,
            "credit_note_total":      credit_note_total,
            "delivered_by_name":      delivered_by_name,
            "created_by_name":        created_by_name,
            "order_number":           pedido_number,
            "updated_at":             now,
        }

        cols     = list(data.keys())
        ph       = ", ".join(["%s"] * len(cols))
        col_list = ", ".join([f'"{c}"' for c in cols])
        sql      = f'INSERT INTO orders ({col_list}) VALUES ({ph})'

        try:
            with conn.cursor() as cur:
                cur.execute(sql, list(data.values()))
            conn.commit()
            success += 1
        except Exception as e:
            conn.rollback()
            failed.append({"row": int(idx) + 2, "receipt": receipt_number, "error": str(e)})

    conn.close()

    # ── Reporte ───────────────────────────────────────────────────────────────
    report_path = os.path.join(BASE_DIR, "scripts", "excel_import", "import_report.txt")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"REPORTE - {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Exitosos: {success}\nFallidos: {len(failed)}\n")
        f.write(f"\nDISTRIBUCIÓN DE ESTADOS:\n")
        for st, cnt in status_counts.items():
            f.write(f"  {st}: {cnt}\n")
        if failed:
            f.write("\nFILAS FALLIDAS:\n")
            for item in failed:
                f.write(f"  Fila #{item['row']} [{item['receipt']}] → {item['error']}\n")

    print(f"\n  ✅ Exitosos         : {success}")
    print(f"  ❌ Fallidos         : {len(failed)}")
    print(f"\n  📊 DISTRIBUCIÓN DE ESTADOS:")
    print(f"     POR_RECIBIR       : {status_counts.get('POR_RECIBIR', 0)}  (pendientes de ingreso a bodega)")
    print(f"     RECIBIDO_EN_BODEGA: {status_counts.get('RECIBIDO_EN_BODEGA', 0)}  (en bodega, listos para entrega)")
    print(f"     ENTREGADO         : {status_counts.get('ENTREGADO', 0)}  (ya entregados al cliente)")
    print(f"\n  📄 Reporte  : scripts/excel_import/import_report.txt")

if __name__ == "__main__":
    main()
