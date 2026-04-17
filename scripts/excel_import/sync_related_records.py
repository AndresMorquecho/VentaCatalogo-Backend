#!/usr/bin/env python3
"""
Genera los registros relacionados para las órdenes importadas:
  - order_payments  (abono = real_invoice_total si > 0)
  - financial_records (movimiento contable por cada pago)
  - client_accounts  (una por cliente si no existe)
  - bank_accounts.current_balance  (recalculado desde financial_records)

Uso: python scripts/excel_import/sync_related_records.py
"""

import os
import sys
import uuid
import datetime
import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌  No se encontró DATABASE_URL")
    sys.exit(1)

def main():
    print("=" * 60)
    print("   SINCRONIZAR REGISTROS RELACIONADOS")
    print("=" * 60)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    now = datetime.datetime.now()

    # ── 1. Cargar órdenes importadas ─────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, receipt_number, client_id, client_name,
                   total, real_invoice_total, credit_note_total,
                   transaction_date, status, brand_id
            FROM orders
            WHERE sales_channel = 'IMPORTADO'
        """)
        orders = cur.fetchall()
    print(f"\n📦  Órdenes importadas: {len(orders)}")

    # ── 2. Obtener cuenta bancaria por defecto (CASH primero, luego cualquiera) ──
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, current_balance, version FROM bank_accounts WHERE type = 'CASH' LIMIT 1")
        bank = cur.fetchone()
        if not bank:
            cur.execute("SELECT id, name, current_balance, version FROM bank_accounts LIMIT 1")
            bank = cur.fetchone()

    if not bank:
        print("❌  No hay cuentas bancarias en la DB. Crea al menos una primero.")
        sys.exit(1)

    bank_id, bank_name, bank_balance, bank_version = bank
    print(f"🏦  Cuenta bancaria usada: {bank_name} (balance actual: {bank_balance})")

    # ── 3. Órdenes que ya tienen order_payment (no duplicar) ─────
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT order_id FROM order_payments")
        already_paid = {r[0] for r in cur.fetchall()}
    print(f"✅  Órdenes ya con pago: {len(already_paid)}")

    # ── 4. Clientes que ya tienen client_account ─────────────────
    with conn.cursor() as cur:
        cur.execute("SELECT client_id FROM client_accounts")
        existing_accounts = {r[0] for r in cur.fetchall()}

    # ── 5. Procesar cada orden ────────────────────────────────────
    payments_created   = 0
    financial_created  = 0
    accounts_created   = 0
    total_income       = 0.0
    failed             = []

    for order in orders:
        (order_id, receipt_number, client_id, client_name,
         total, real_invoice_total, credit_note_total,
         transaction_date, status, brand_id) = order

        abono = float(real_invoice_total) if real_invoice_total else 0.0
        total_val = float(total) if total else 0.0

        # ── 5a. client_account ───────────────────────────────────
        if client_id not in existing_accounts:
            acc_id = str(uuid.uuid4())
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO client_accounts (
                            id, client_id, total_credit_available,
                            total_reward_points, total_orders, total_spent,
                            reward_level, updated_at
                        ) VALUES (%s, %s, 0, 0, 0, 0, 'BRONCE', %s)
                        ON CONFLICT (client_id) DO NOTHING
                    """, (acc_id, client_id, now))
                conn.commit()
                existing_accounts.add(client_id)
                accounts_created += 1
            except Exception as e:
                conn.rollback()
                failed.append(f"client_account {client_id}: {e}")

        # ── 5b. order_payment + financial_record (solo si hay abono) ──
        if order_id in already_paid or abono <= 0:
            continue

        payment_id  = str(uuid.uuid4())
        fin_id      = str(uuid.uuid4())
        ref_number  = f"REF-IMP-{receipt_number}-{str(uuid.uuid4())[:6]}"
        pay_receipt = f"PAY-IMP-{receipt_number}"
        tx_date     = transaction_date if transaction_date else now

        try:
            with conn.cursor() as cur:
                # order_payment
                cur.execute("""
                    INSERT INTO order_payments (
                        id, order_id, amount, method, reference,
                        receipt_number, description, is_adjustment
                    ) VALUES (%s, %s, %s, 'IMPORTADO', %s, %s, %s, false)
                """, (
                    payment_id, order_id, abono,
                    ref_number, pay_receipt,
                    f"Abono importado desde Excel | Recibo {receipt_number}"
                ))

                # financial_record
                cur.execute("""
                    INSERT INTO financial_records (
                        id, type, reference_number, amount, date,
                        client_id, client_name, order_id, order_payment_id,
                        created_by, bank_account_id, source,
                        payment_method, movement_type,
                        balance_before, balance_after,
                        is_reversal, version
                    ) VALUES (
                        %s, 'PAYMENT', %s, %s, %s,
                        %s, %s, %s, %s,
                        'IMPORTADO', %s, 'ORDER_PAYMENT',
                        'IMPORTADO', 'INCOME',
                        %s, %s,
                        false, 1
                    )
                """, (
                    fin_id, ref_number, abono, tx_date,
                    client_id, client_name, order_id, payment_id,
                    bank_id,
                    float(bank_balance) + total_income,
                    float(bank_balance) + total_income + abono
                ))

            conn.commit()
            already_paid.add(order_id)
            payments_created  += 1
            financial_created += 1
            total_income      += abono

        except Exception as e:
            conn.rollback()
            failed.append(f"order {receipt_number}: {e}")

    # ── 6. Actualizar current_balance de la cuenta bancaria ──────
    print(f"\n💰  Actualizando saldo de '{bank_name}'...")
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE bank_accounts
                SET current_balance = (
                    SELECT COALESCE(SUM(
                        CASE WHEN movement_type = 'INCOME' THEN amount
                             WHEN movement_type = 'EXPENSE' THEN -amount
                             ELSE 0 END
                    ), 0)
                    FROM financial_records
                    WHERE bank_account_id = %s
                ),
                updated_at = %s,
                version = version + 1
                WHERE id = %s
            """, (bank_id, now, bank_id))
        conn.commit()

        with conn.cursor() as cur:
            cur.execute("SELECT current_balance FROM bank_accounts WHERE id = %s", (bank_id,))
            new_balance = cur.fetchone()[0]
        print(f"  ✔  Nuevo saldo: {new_balance}")
    except Exception as e:
        conn.rollback()
        print(f"  ❌  Error actualizando saldo: {e}")

    conn.close()

    # ── 7. Resumen ────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"  ✅  client_accounts creados : {accounts_created}")
    print(f"  ✅  order_payments creados  : {payments_created}")
    print(f"  ✅  financial_records creados: {financial_created}")
    print(f"  💵  Total ingresado         : ${total_income:,.2f}")
    if failed:
        print(f"\n  ❌  Errores ({len(failed)}):")
        for f in failed[:10]:
            print(f"     • {f}")
    print("=" * 60)

if __name__ == "__main__":
    main()
