import psycopg2, os, pandas as pd
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, '.env'))

# Read Excel to understand columns
EXCEL_FILE = os.path.join(BASE_DIR, "EXCEL", "1111.xls")
df = pd.read_excel(EXCEL_FILE, sheet_name=0, engine="xlrd", dtype=str)
df = df.where(pd.notna(df), None)

print("Columns:", list(df.columns))
print("\nFirst 5 rows, key columns:")
key_cols = ['No de recibo', 'Pedido', 'Tipo', 'Recibo de entrega', 'No factura']
available = [c for c in key_cols if c in df.columns]
print(df[available].head(5).to_string())
