import pandas as pd
import json
import os

file_path = r"c:\Users\Morqu\OneDrive\Escritorio\VentasCatalogo\Backend\VentaCatalogo-Backend\EXCEL\INVENTARIO DE PEDIDOS AL 21-4-2026.xlsx"

df = pd.read_excel(file_path)

# Rename columns to safe names
df.columns = [
    'receiptNumber', 'emissionDate', 'createdBy', 'orderNumber', 'type', 'catalog', 
    'identification', 'clientName', 'phone1', 'phone2', 'phone3', 'orderValue', 
    'possibleDeliveryDate', 'invoiceNumber', 'realInvoiceTotal', 'paidAmount', 'balance', 
    'entryDate', 'received', 'deliveryDate', 'delivered', 'deliveredBy', 'deliveryNumber'
]

# Filter only rows that have either received: SI or delivered: SI
legacy_orders = df[(df['received'] == 'SI') | (df['delivered'] == 'SI')]

result = []
for _, row in legacy_orders.iterrows():
    result.append({
        'receiptNumber': str(row['receiptNumber']),
        'orderNumber': str(row['orderNumber']) if pd.notna(row['orderNumber']) else None,
        'received': str(row['received']) == 'SI',
        'delivered': str(row['delivered']) == 'SI',
        'total': float(row['realInvoiceTotal']) if pd.notna(row['realInvoiceTotal']) else 0.0,
        'paid': float(row['paidAmount']) if pd.notna(row['paidAmount']) else 0.0,
        'invoiceNumber': str(row['invoiceNumber']) if pd.notna(row['invoiceNumber']) else None,
        'deliveryNumber': str(row['deliveryNumber']) if pd.notna(row['deliveryNumber']) else None,
        'emissionDate': str(row['emissionDate']) if pd.notna(row['emissionDate']) else None
    })

output_path = r"c:\Users\Morqu\OneDrive\Escritorio\VentasCatalogo\Backend\VentaCatalogo-Backend\scratch\legacy_orders.json"
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(result, f, indent=2)

print(f"Exported {len(result)} legacy orders to {output_path}")
