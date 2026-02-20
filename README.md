# VentasCatalogo Backend API

Backend API para el sistema de gestión de pedidos por catálogo, construido con **Arquitectura Hexagonal** (Ports & Adapters) organizada por features.

## 🚀 Inicio Rápido

**👉 [EMPIEZA AQUÍ - START_HERE.md](./START_HERE.md)**

O sigue estos pasos:

```bash
# 1. Configurar Neon Database (ver NEON_SETUP.md)
cp .env.example .env
# Editar .env con tu DATABASE_URL de Neon

# 2. Crear tablas
npm run prisma:push

# 3. Insertar datos
npm run seed

# 4. Iniciar servidor
npm run dev
```

## 🏗️ Arquitectura

**Tipo**: Hexagonal (Ports & Adapters) + Feature-based  
**Versión**: 2.0.0

```
features/
├── orders/          ✅ Migrado
│   ├── domain/      # Lógica de negocio pura
│   ├── application/ # Casos de uso
│   └── infrastructure/ # Adaptadores (Prisma, HTTP)
├── financial/       ✅ Migrado
└── clients/         ⏳ Pendiente
```

Ver [HEXAGONAL_ARCHITECTURE.md](./HEXAGONAL_ARCHITECTURE.md) para detalles completos.

## 🚀 Stack Tecnológico

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Language**: TypeScript
- **ORM**: Prisma
- **Database**: PostgreSQL (Neon)
- **Auth**: JWT
- **Architecture**: Hexagonal (Ports & Adapters)
- **Patterns**: DDD, Repository, Use Case, Result

## 📋 Prerequisitos

- Node.js 20 o superior
- pnpm, npm o yarn
- Cuenta en Neon (https://neon.tech) para PostgreSQL

## 🔧 Instalación

### 1. Instalar dependencias

```bash
npm install
# o
pnpm install
```

### 2. Configurar variables de entorno

Copia el archivo `.env.example` a `.env`:

```bash
cp .env.example .env
```

Edita `.env` y configura:

```env
# Database - Obtén esta URL desde tu dashboard de Neon
DATABASE_URL="postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET=tu-clave-secreta-super-segura-cambiala-en-produccion
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=http://localhost:5173
```

### 3. Configurar Neon Database

1. Ve a https://neon.tech y crea una cuenta
2. Crea un nuevo proyecto
3. Copia la connection string (DATABASE_URL)
4. Pégala en tu archivo `.env`

### 4. Generar Prisma Client y crear tablas

```bash
# Generar el cliente de Prisma
npm run prisma:generate

# Crear las tablas en la base de datos
npm run prisma:push

# O si prefieres usar migraciones
npm run prisma:migrate
```

### 5. (Opcional) Seed inicial

```bash
npm run seed
```

## 🏃 Ejecutar el servidor

### Modo desarrollo (con hot reload)

```bash
npm run dev
```

### Modo producción

```bash
npm run build
npm start
```

El servidor estará disponible en `http://localhost:3000`

## 📚 Endpoints Principales

### Auth
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Registro

### Orders
- `GET /api/orders` - Listar pedidos
- `GET /api/orders/:id` - Obtener pedido
- `POST /api/orders` - Crear pedido
- `PUT /api/orders/:id` - Actualizar pedido
- `DELETE /api/orders/:id` - Cancelar pedido

### Clients
- `GET /api/clients` - Listar clientes
- `GET /api/clients/:id` - Obtener cliente
- `POST /api/clients` - Crear cliente
- `PUT /api/clients/:id` - Actualizar cliente

### Payments
- `POST /api/payments` - Registrar pago
- `GET /api/payments` - Listar pagos

### Financial
- `GET /api/financial-movements` - Movimientos financieros
- `POST /api/financial-movements` - Crear movimiento manual

### Dashboard
- `GET /api/dashboard/metrics` - Métricas del dashboard

### Otros
- `GET /api/brands` - Marcas
- `GET /api/bank-accounts` - Cuentas bancarias
- `GET /api/inventory/movements` - Inventario
- `GET /api/calls` - Llamadas
- `GET /api/rewards` - Recompensas

## 🔐 Autenticación

Todos los endpoints (excepto `/auth/login` y `/auth/register`) requieren autenticación JWT.

Incluye el token en el header:

```
Authorization: Bearer {tu-token-jwt}
```

## 🗄️ Prisma Studio

Para explorar la base de datos visualmente:

```bash
npm run prisma:studio
```

## 🏗️ Arquitectura

```
backend/
├── prisma/
│   └── schema.prisma          # Esquema de base de datos
├── src/
│   ├── lib/
│   │   └── prisma.ts          # Cliente de Prisma
│   ├── middleware/
│   │   ├── auth.ts            # Autenticación JWT
│   │   ├── errorHandler.ts   # Manejo de errores
│   │   └── requestLogger.ts  # Logger de requests
│   ├── routes/
│   │   ├── orders.routes.ts
│   │   ├── clients.routes.ts
│   │   └── ...
│   ├── services/
│   │   ├── orders.service.ts
│   │   ├── clients.service.ts
│   │   └── financialRecord.service.ts
│   └── index.ts               # Entry point
├── .env                       # Variables de entorno
├── package.json
└── tsconfig.json
```

## ✅ Características Implementadas

### Correcciones Arquitectónicas

✅ **Sistema Financiero Unificado**: `FinancialRecord` combina Transaction + Movement  
✅ **Transaccionalidad ACID**: Todas las operaciones críticas usan `prisma.$transaction`  
✅ **Control de Concurrencia**: Campo `version` en entidades críticas  
✅ **Constraints de Unicidad**: `referenceNumber`, `identificationNumber`, etc.  
✅ **ClientAccount Aggregate**: Créditos y rewards bajo un solo agregado  
✅ **Validaciones de Negocio**: Cédula ecuatoriana, montos positivos, etc.

### Seguridad

✅ JWT Authentication  
✅ Password hashing con bcrypt  
✅ CORS configurado  
✅ Error handling robusto  
✅ Validación de inputs

## 🔄 Próximos Pasos

1. **Conectar Frontend**: Actualizar las APIs del frontend para apuntar a este backend
2. **Recepción de Pedidos**: Implementar endpoint `/api/orders/batch-reception`
3. **Entrega de Pedidos**: Implementar endpoint `/api/orders/:id/deliver`
4. **Uso de Créditos**: Implementar endpoint `/api/clients/:id/credits/use`
5. **Cierre de Caja**: Implementar endpoint `/api/cash-closure`
6. **Tests**: Agregar tests unitarios e integración
7. **Documentación API**: Swagger/OpenAPI

## 📝 Notas Importantes

- El sistema usa **Optimistic Locking** con el campo `version`
- Los créditos se generan automáticamente cuando hay exceso de pago
- Los nombres de clientes se sincronizan automáticamente en orders y financial records
- Todas las operaciones financieras actualizan el balance de cuentas bancarias
- El sistema valida cédulas ecuatorianas con el algoritmo módulo 10

## 🐛 Troubleshooting

### Error: "Can't reach database server"
- Verifica que tu DATABASE_URL sea correcta
- Asegúrate de que tu IP esté permitida en Neon (por defecto permite todas)

### Error: "Prisma Client not generated"
```bash
npm run prisma:generate
```

### Error: "Table does not exist"
```bash
npm run prisma:push
```

## 📞 Soporte

Para problemas o preguntas, revisa:
- `AUDITORIA_ARQUITECTONICA_COMPLETA.md` en el frontend
- `API_CONTRACTS_BACKEND.md` en el frontend
- Documentación de Prisma: https://www.prisma.io/docs
- Documentación de Neon: https://neon.tech/docs

---

**Versión**: 1.0.0  
**Última actualización**: 2026-02-20
