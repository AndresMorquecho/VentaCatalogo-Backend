import os
import pandas as pd

BASE_DIR = r"c:\Users\Morqu\OneDrive\Escritorio\VentasCatalogo\Backend\VentaCatalogo-Backend"
files = ["FormatoEmpresariaActivas.xlsx", "FormatoEmpresariaInactivas.xlsx"]

for f in files:
    path = os.path.join(BASE_DIR, "EXCEL", f)
    print(f"\n--- Inspecting {f} ---")
    try:
        # Use openpyxl for .xlsx
        df = pd.read_excel(path, sheet_name=0, engine="openpyxl", nrows=5)
        print("Columns:", list(df.columns))
        print("\nFirst 2 rows:")
        print(df.head(2).to_string())
    except Exception as e:
        print(f"Error reading {f}: {e}")
