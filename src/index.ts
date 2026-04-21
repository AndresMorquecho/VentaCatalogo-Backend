import 'reflect-metadata';
import './config/env'; // Loads dotenv and validates critical env vars

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

// Feature-based routes (Hexagonal Architecture)
import orderRoutes from './features/orders/infrastructure/order.routes';
import financialRoutes from './features/financial/infrastructure/financial.routes';
import paymentRoutes from './features/payments/infrastructure/payment.routes';
import inventoryRoutes from './features/inventory/infrastructure/inventory.routes';
import dashboardRoutes from './features/dashboard/infrastructure/dashboard.routes';
import callsRoutes from './features/calls/infrastructure/calls.routes';
import cashClosureRoutes from './features/cash-closures/infrastructure/cash-closures.routes';
import portfolioRecoveryRoutes from './features/portfolio-recovery/infrastructure/portfolio-recovery.routes';
import walletRoutes from './routes/wallet.routes';
import systemSettingsRoutes from './routes/system-settings.routes';
import catalogRoutes from './features/catalogs/infrastructure/catalogs.routes';
import locksRoutes from './features/locks/infrastructure/locks.routes';

// Legacy routes (pending hexagonal migration)
import authRouter from './routes/auth.routes';
import clientsRouter from './routes/clients.routes';
import brandsRouter from './routes/brands.routes';
import bankAccountsRouter from './routes/bankAccounts.routes';
import rewardsRouter from './routes/rewards.routes';
import loyaltyRouter from './routes/loyalty.routes';
import clientCreditsRouter from './routes/clientCredits.routes';
import usersRouter from './routes/users.routes';
import rolesRouter from './routes/roles.routes';
import auditRouter from './routes/audit.routes';
import exchangesRouter from './routes/exchanges.routes';

const app = express();
const PORT = env.PORT;

// Fix for Render/Proxies: Trust the first proxy (Render uses a load balancer)
app.set('trust proxy', 1);

// Fix 1: Add Helmet for HTTP headers security
app.use(helmet());

// Rate Limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: { success: false, error: { message: 'Demasiados intentos de inicio de sesión. Intente más tarde.' } }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // limit each IP to 200 requests per minute
  message: { success: false, error: { message: 'Demasiadas peticiones desde esta IP. Intente más tarde.' } },
  skip: (req) => req.path.startsWith('/api/auth') // Let authLimiter handle /api/auth
});

// Applicar límites
app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// CORS with validated config
const origins = env.CORS_ORIGIN.split(',');

app.use(cors({
  origin: origins,
  credentials: true
}));
app.use(express.json());
app.use(requestLogger);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    architecture: 'hexagonal',
    deployment_test: true
  });
});

app.get('/api/ping', (_req, res) => res.json({ message: 'pong' }));

// API Routes - Feature-based (Hexagonal)
app.use('/api/orders', orderRoutes);
app.use('/api/financial-records', financialRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/cash-closures', cashClosureRoutes);
app.use('/api/portfolio', portfolioRecoveryRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/catalogs', catalogRoutes);
app.use('/api/system-settings', systemSettingsRoutes);
app.use('/api/locks', locksRoutes);

// API Routes - Legacy (to be migrated)
app.use('/api/auth', authRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/brands', brandsRouter);
app.use('/api/bank-accounts', bankAccountsRouter);
app.use('/api/rewards', rewardsRouter);
app.use('/api/loyalty', loyaltyRouter);
app.use('/api/client-credits', clientCreditsRouter);
app.use('/api/users', usersRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/audit', auditRouter);
app.use('/api/exchanges', exchangesRouter);

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${env.NODE_ENV}`);
  console.log(`CORS Origins: ${origins.join(', ')}`);
  console.log(`Architecture: Hexagonal (Feature-based)`);
});