import pandas as pd
file_path = r"c:\Users\Morqu\OneDrive\Escritorio\VentasCatalogo\Backend\VentaCatalogo-Backend\EXCEL\OrdenesCambiarEstado.xlsx"
df = pd.read_excel(file_path)
receipts = df.iloc[:, 0].astype(str).tolist()
unique_receipts = set(receipts)
print(f"Total rows in Excel: {len(receipts)}")
print(f"Unique receipt numbers in Excel: {len(unique_receipts)}")
print(f"Duplicates in Excel: {len(receipts) - len(unique_receipts)}")
