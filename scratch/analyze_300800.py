import pandas as pd
import os

file_path = r"c:\Users\Morqu\OneDrive\Escritorio\VentasCatalogo\Backend\VentaCatalogo-Backend\EXCEL\INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx"

df = pd.read_excel(file_path)
match = df[df['No de recibo'] == 300800]
print(match.to_dict(orient='records'))
