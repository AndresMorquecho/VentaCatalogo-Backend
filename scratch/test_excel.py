import pandas as pd
import os

path = "EXCEL/FormatoEmpresariaActivas.xlsx"
print(f"Reading {path}...")
df = pd.read_excel(path)
print(f"Read {len(df)} rows.")

path2 = "EXCEL/INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx"
print(f"Reading {path2}...")
df2 = pd.read_excel(path2)
print(f"Read {len(df2)} rows.")
