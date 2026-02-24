import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

// Feature-based routes (Hexagonal Architecture)
import orderRoutes from './features/orders/infrastructure/order.routes';
import financialRoutes from './features/financial/infrastructure/financial.routes';
import paymentRoutes from './features/payments/infrastructure/payment.routes';

// Legacy routes (to be migrated)
import authRouter from './routes/auth.routes';
import clientsRouter from './routes/clients.routes';
import brandsRouter from './routes/brands.routes';
import bankAccountsRouter from './routes/bankAccounts.routes';
import dashboardRouter from './routes/dashboard.routes';
import inventoryRouter from './routes/inventory.routes';
import callsRouter from './routes/calls.routes';
import rewardsRouter from './routes/rewards.routes';
import loyaltyRouter from './routes/loyalty.routes';
import clientCreditsRouter from './routes/clientCredits.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(requestLogger);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    architecture: 'hexagonal'
  });
});

// API Routes - Feature-based (Hexagonal)
app.use('/api/orders', orderRoutes);
app.use('/api/financial-records', financialRoutes);
app.use('/api/payments', paymentRoutes);

// API Routes - Legacy (to be migrated)
app.use('/api/auth', authRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/brands', brandsRouter);
app.use('/api/bank-accounts', bankAccountsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/calls', callsRouter);
app.use('/api/rewards', rewardsRouter);
app.use('/api/loyalty', loyaltyRouter);
app.use('/api/client-credits', clientCreditsRouter);

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🏗️  Architecture: Hexagonal (Feature-based)`);
});
