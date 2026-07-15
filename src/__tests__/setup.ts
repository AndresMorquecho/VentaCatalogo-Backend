import { vi } from 'vitest';

// Setup test environment
vi.mock('@/shared/infrastructure/database', () => ({
  prisma: {
    $transaction: vi.fn(),
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    client: {
      update: vi.fn(),
    },
  },
}));
