/**
 * Environment variable validation module.
 * This module MUST be the first import in index.ts.
 * It loads dotenv from the project root and validates all critical vars.
 * If any critical variable is missing, the server will refuse to start.
 */
import path from 'path';
import dotenv from 'dotenv';

// Load .env from the project root (2 levels up from src/config/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const REQUIRED_VARS = ['DATABASE_URL', 'JWT_SECRET'];

for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
        console.error(`\n FATAL: Environment variable "${key}" is not set.`);
        console.error(`   The server cannot start safely without all required environment variables.`);
        console.error(`   Please set "${key}" in your .env file and restart.\n`);
        process.exit(1);
    }
}

// Warn about optional but important vars
if (!process.env.CORS_ORIGIN) {
    console.warn(` WARNING: CORS_ORIGIN is not set. Defaulting to http://localhost:5173`);
    console.warn(`   In production, set CORS_ORIGIN to your frontend URL.`);
}

if (!process.env.JWT_EXPIRES_IN) {
    console.warn(` WARNING: JWT_EXPIRES_IN is not set. Defaulting to 7d`);
}

// Exported validated env vars (guaranteed non-null after this point)
export const env = {
    DATABASE_URL: process.env.DATABASE_URL!,
    JWT_SECRET: process.env.JWT_SECRET!,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
    PORT: parseInt(process.env.PORT || '3000', 10),
    NODE_ENV: process.env.NODE_ENV || 'development',
    IS_PRODUCTION: process.env.NODE_ENV === 'production',
    FRONTEND_URL: process.env.FRONTEND_URL || (process.env.CORS_ORIGIN?.split(',')[0]) || 'http://localhost:5173',
}