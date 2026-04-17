#!/usr/bin/env python3
"""
Ejecuta todos los scripts de importación en orden.
Uso: python scripts/excel_import/run_all.py
"""

import subprocess
import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

scripts = [
    ("Marcas",       "insert_brands.py"),
    ("Clientes",     "insert_clients.py"),
    ("Usuarios",     "insert_users.py"),
    ("Órdenes",      "import_excel.py"),
    ("Order Items",  "insert_order_items.py"),
]

print("=" * 60)
print("   IMPORTACIÓN COMPLETA DESDE EXCEL")
print("=" * 60)

for label, script in scripts:
    path = os.path.join(BASE_DIR, script)
    print(f"\n▶  {label} ({script})")
    print("─" * 60)
    result = subprocess.run([sys.executable, path])
    if result.returncode != 0:
        print(f"\n❌  Error en {script}. Abortando.")
        sys.exit(1)

print("\n" + "=" * 60)
print("   ✅  IMPORTACIÓN COMPLETA FINALIZADA")
print("=" * 60)
