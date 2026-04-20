# 🚀 Guía de Migración de Excel a Seenode

Esta guía detalla los pasos para migrar datos desde archivos Excel a la nueva base de datos en Seenode, minimizando errores de conexión y conflictos de esquema.

## 1. Requisitos Previos (Python)
Asegúrate de tener instaladas las librerías necesarias para ejecutar el script de importación:

```bash
pip install pandas psycopg2-binary xlrd python-dotenv
```

## 2. Configuración del Entorno (.env)
Seenode tiene límites de conexión estrictos. Para que el backend no colapse, usamos `connection_limit=2`. Sin embargo, el script de Python **no siempre es compatible** con este parámetro.

### Pasos para ejecutar la importación:
1.  **Abrir el archivo `.env`**.
2.  **Quitar temporalmente** el texto `?connection_limit=2` de la `DATABASE_URL`.
3.  **Ejecutar el script** (ver sección 3).
4.  **Restablecer** el texto `?connection_limit=2` al finalizar para que el Backend funcione estable.

## 3. Comandos de Ejecución
Ejecuta el script desde la raíz del proyecto `Backend/VentaCatalogo-Backend`:

```powershell
# En Windows, usa este comando para evitar errores de caracteres (UTF-8):
$env:PYTHONUTF8=1; python scripts/excel_import/import_excel.py
```

## 4. Limpieza de Base de Datos (Reset)
Si necesitas borrar los datos importados para volver a empezar sin borrar la estructura de la base de datos:

### Opción A: Limpiar solo lo importado por Excel
El script ya lo hace automáticamente al principio (`DELETE FROM orders WHERE sales_channel = 'IMPORTADO'`), pero puedes hacerlo manual si lo necesitas.

### Opción B: Limpiar TODA la base de datos (Cuidado)
Si algo salió muy mal y quieres vaciar las tablas manteniendo la estructura:
```bash
npx prisma db push --force-reset
```
*Esto borrará TODOS los datos. Luego deberás correr el seed:*
```bash
npm run seed
```

## 5. Resolución de Problemas Comunes

| Error | Causa | Solución |
| :--- | :--- | :--- |
| `FATAL: too many clients` | Demasiadas conexiones abiertas. | Cierra Prisma Studio y pon `connection_limit=2` en el `.env`. |
| `Address already in use` | El servidor ya está corriendo. | Ejecuta `taskkill /F /IM node.exe` para liberar los puertos. |
| `invalid dsn: connection_limit` | Python no entiende el limit. | Quita el `?connection_limit=2` del `.env` mientras corres el script de Python. |

---
**Nota:** El script actual busca el archivo en `EXCEL/1111.xls`. Si cambias el nombre del archivo, debes actualizar la variable `EXCEL_FILE` dentro del script `import_excel.py`.
