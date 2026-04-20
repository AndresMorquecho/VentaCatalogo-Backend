import psycopg2, os
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, '.env'))

conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()

cur.execute("SELECT status, COUNT(*) FROM orders WHERE sales_channel='IMPORTADO' GROUP BY status")
print('IMPORTADO status counts:', cur.fetchall())

cur.execute("SELECT COUNT(*) FROM orders WHERE status IN ('RECIBIDO_EN_BODEGA','ENTREGADO')")
print('Total RECIBIDO+ENTREGADO:', cur.fetchone())

cur.execute("SELECT COUNT(*) FROM clients")
print('Total clients:', cur.fetchone())

cur.execute("SELECT order_number, status FROM orders WHERE sales_channel='IMPORTADO' LIMIT 5")
print('Sample orders (order_number, status):', cur.fetchall())

conn.close()
