import pandas as pd
import os

file_path = r"c:\Users\Morqu\OneDrive\Escritorio\VentasCatalogo\Backend\VentaCatalogo-Backend\EXCEL\INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx"

if not os.path.exists(file_path):
    print(f"Error: File not found at {file_path}")
    exit(1)

try:
    # Read the excel file
    df = pd.read_excel(file_path)
    print("Columns found:")
    print(df.columns.tolist())
    
    print("\nFirst 5 rows:")
    print(df.head())

    # User mentioned "N° de recibo 300800"
    # Let's find it.
    # Column names are likely "RECIBO", "ENTREGADO", "N° RECIBO", etc.
    # From screenshot, columns are: "POSIBLE ENTREGA", "NO. FACTURA", "VALOR DE FACTURA", "ABONO", "SALDO", "FECHA DE INGRESO", "RECIBIDO", "FECHA DE ENTREGA", "ENTREGADO", "RECIBO DE ENTREGA"
    
    # Search for a row with 300800. Since it's a receipt number, it might be in a column named "RECIBO" or similar.
    # Wait, the screenshot shows "Recibo: 300800" in the system UI.
    
    # Let's try to find 300800 in any column.
    match = df[df.apply(lambda row: row.astype(str).str.contains('300800').any(), axis=1)]
    if not match.empty:
        print("\nFound 300800:")
        print(match)
    else:
        print("\n300800 not found in Excel.")

except Exception as e:
    print(f"Error reading Excel: {e}")
