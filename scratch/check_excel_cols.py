import pandas as pd
import os

BASE_DIR = r"c:\Users\Morqu\OneDrive\Escritorio\VentasCatalogo\Backend\VentaCatalogo-Backend"
excel_path = os.path.join(BASE_DIR, "EXCEL", "INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx")

df = pd.read_excel(excel_path, engine="openpyxl")
print("Columns:")
for i, col in enumerate(df.columns):
    print(f"{i}: {col}")

for i, row in df.head(5).iterrows():
    vals = row.values
    print(f"\n--- Row {i} ---")
    for idx, v in enumerate(vals):
        print(f"{idx}: {df.columns[idx]} -> {repr(v)}")
