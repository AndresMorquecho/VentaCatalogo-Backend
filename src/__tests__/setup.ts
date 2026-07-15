import { vi } from 'vitest';

// Setup test environment
vi.mock('../lib/prisma', () => ({
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
