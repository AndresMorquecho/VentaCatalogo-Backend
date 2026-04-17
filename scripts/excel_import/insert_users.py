#!/usr/bin/env python3
"""
Extrae usuarios únicos de las columnas 'Ingresado por' y 'Usuario entrego'
del Excel y los inserta en la tabla users (sin duplicados).

Uso: python scripts/excel_import/insert_users.py

Password por defecto: password123
Username: nombre completo en minúsculas con guiones bajos (ej: diego_david_carrillo_andrade)
"""

import os
import sys
import uuid
import datetime
import hashlib
import pandas as pd
import psycopg2
from dotenv import load_dotenv

# ─── Config ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌  No se encontró DATABASE_URL en el .env")
    sys.exit(1)

EXCEL_FILE = os.path.join(BASE_DIR, "EXCEL", "1111.xls")
DEFAULT_PASSWORD = "password123"

# ─── Helpers ─────────────────────────────────────────────────────────────────

def name_to_username(full_name: str) -> str:
    """'DIEGO DAVID CARRILLO ANDRADE' → 'diego_david_carrillo_andrade'"""
    return "_".join(full_name.strip().lower().split())

def hash_password(plain: str) -> str:
    """SHA-256 simple. Reemplaza por bcrypt si tu app lo usa."""
    return hashlib.sha256(plain.encode()).hexdigest()

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("   INSERTAR USUARIOS DESDE EXCEL")
    print("=" * 60)

    # 1. Leer Excel y extraer nombres únicos
    print(f"\n📂  Leyendo {os.path.basename(EXCEL_FILE)}...")
    df = pd.read_excel(EXCEL_FILE, sheet_name=0, engine="xlrd", dtype=str)

    names = set()
    for col in ["Ingresado por", "Usuario entrego"]:
        if col in df.columns:
            vals = df[col].dropna().str.strip()
            vals = vals[vals != ""]
            names.update(vals.unique())

    if not names:
        print("❌  No se encontraron nombres en las columnas esperadas.")
        sys.exit(1)

    print(f"✅  {len(names)} usuarios únicos encontrados:")
    for n in sorted(names):
        print(f"    • {n}")

    # 2. Conectar
    print(f"\n🔌  Conectando a la base de datos...")
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    print("✅  Conexión exitosa")

    # 3. Insertar (skip si ya existe el username)
    inserted = 0
    skipped = 0
    now = datetime.datetime.now()

    with conn.cursor() as cur:
        for full_name in sorted(names):
            username = name_to_username(full_name)

            # Verificar si ya existe
            cur.execute("SELECT id FROM users WHERE username = %s", (username,))
            if cur.fetchone():
                print(f"  ⏭  Ya existe: {username}")
                skipped += 1
                continue

            user_id = str(uuid.uuid4())
            password_hash = hash_password(DEFAULT_PASSWORD)

            cur.execute("""
                INSERT INTO users (id, username, password, role, is_active, updated_at)
                VALUES (%s, %s, %s, 'USER', true, %s)
            """, (user_id, username, password_hash, now))

            print(f"  ✔  Creado: {username}  (id: {user_id})")
            inserted += 1

    conn.commit()
    conn.close()

    # 4. Resumen
    print("\n" + "=" * 60)
    print(f"  ✅ Insertados : {inserted}")
    print(f"  ⏭  Omitidos  : {skipped} (ya existían)")
    print("=" * 60)
    print(f"\n  Password por defecto: {DEFAULT_PASSWORD}")
    print("  ⚠  Recuerda cambiar las contraseñas en producción.")

if __name__ == "__main__":
    main()
