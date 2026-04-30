import pandas as pd
import json
import os

file_path = r"c:\Users\Morqu\OneDrive\Escritorio\VentasCatalogo\Backend\VentaCatalogo-Backend\EXCEL\OrdenesCambiarEstado.xlsx"

if not os.path.exists(file_path):
    print(f"Error: File not found at {file_path}")
    exit(1)

df = pd.read_excel(file_path)
print("Columns found:")
print(df.columns.tolist())

# Export the list of receipt numbers to a JSON for the TS script
receipts = df.iloc[:, 0].astype(str).tolist() # Assuming first column is receipt number
print(f"Total receipts in excel: {len(receipts)}")

with open(r"c:\Users\Morqu\OneDrive\Escritorio\VentasCatalogo\Backend\VentaCatalogo-Backend\scratch\target_receipts.json", 'w') as f:
    json.dump(receipts, f)
