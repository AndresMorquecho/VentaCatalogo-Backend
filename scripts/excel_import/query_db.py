import psycopg2, os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()

cur.execute('SELECT id, name FROM brands LIMIT 5')
print('BRANDS:', cur.fetchall())

cur.execute('SELECT id, first_name FROM clients LIMIT 3')
print('CLIENTS:', cur.fetchall())

cur.execute('SELECT DISTINCT sales_channel FROM orders LIMIT 5')
print('SALES_CHANNELS:', cur.fetchall())

cur.execute('SELECT DISTINCT type FROM orders LIMIT 5')
print('TYPES:', cur.fetchall())

cur.execute('SELECT DISTINCT payment_method FROM orders LIMIT 5')
print('PAYMENT_METHODS:', cur.fetchall())

conn.close()
