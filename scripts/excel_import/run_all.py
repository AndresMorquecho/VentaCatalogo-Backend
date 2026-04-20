#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ejecuta todos los scripts de importacion en orden.
Uso: python -X utf8 scripts/excel_import/run_all.py
"""

import subprocess
import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

scripts = [
    ("Marcas",                 "insert_brands.py"),
    ("Clientes",               "insert_clients.py"),
    ("Usuarios",               "insert_users.py"),
    ("Ordenes",                "import_excel.py"),
    ("Order Items",            "insert_order_items.py"),
    ("Registros relacionados", "sync_related_records.py"),
]

print("=" * 60)
print("   IMPORTACION COMPLETA DESDE EXCEL")
print("=" * 60)

# Pasar -X utf8 para evitar UnicodeEncodeError en Windows
python_cmd = [sys.executable, "-X", "utf8"]

for label, script in scripts:
    path = os.path.join(BASE_DIR, script)
    print(f"\n>> {label} ({script})")
    print("-" * 60)
    result = subprocess.run(python_cmd + [path])
    if result.returncode != 0:
        print(f"\nERROR en {script}. Abortando.")
        sys.exit(1)

print("\n" + "=" * 60)
print("   IMPORTACION COMPLETA FINALIZADA")
print("=" * 60)
