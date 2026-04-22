import os
import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))
DATABASE_URL = os.getenv("DATABASE_URL")

def main():
    dsn = DATABASE_URL
    if "?" in dsn: dsn = dsn.split("?")[0]
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            with open("scratch/hard_reset.sql", "r") as f:
                sql = f.read()
            print("Ejecutando Hard Reset SQL...")
            cur.execute(sql)
            conn.commit()
            print("Hard Reset COMPLETADO.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
