export interface ExchangeNumberParts {
  prefix: string;   // "EX"
  year: number;     // e.g. 2026
  sequence: number; // e.g. 1
}

const EXCHANGE_NUMBER_REGEX = /^EX-(\d{4})-(\d{3})$/;

export function parseExchangeNumber(s: string): ExchangeNumberParts {
  const match = s.match(EXCHANGE_NUMBER_REGEX);
  if (!match) {
    throw new Error(`Formato de número de cambio inválido: se esperaba EX-YYYY-NNN, recibido: "${s}"`);
  }
  return {
    prefix: 'EX',
    year: parseInt(match[1], 10),
    sequence: parseInt(match[2], 10),
  };
}

export function formatExchangeNumber(parts: ExchangeNumberParts): string {
  const seq = String(parts.sequence).padStart(3, '0');
  return `${parts.prefix}-${parts.year}-${seq}`;
}

export async function generateNextExchangeNumber(
  tx: { orderExchange: { findFirst: Function } },
  year: number
): Promise<string> {
  const last = await tx.orderExchange.findFirst({
    where: {
      exchangeNumber: { startsWith: `EX-${year}-` },
    },
    orderBy: { exchangeNumber: 'desc' },
    select: { exchangeNumber: true },
  });

  let nextSequence = 1;
  if (last) {
    const parts = parseExchangeNumber(last.exchangeNumber);
    nextSequence = parts.sequence + 1;
  }

  return formatExchangeNumber({ prefix: 'EX', year, sequence: nextSequence });
}
