/**
 * Contador único anual para cambios: alinea N° registro envío (ENV) y consecutivo CAM.
 * Evita depender del MAX lexicográfico sobre pedidos (podía inflar o desincronizar el correlativo).
 */
const seqKey = (year: number) => `SEQ_EXCHANGE_ENVIO_${year}`;

function padSeq(n: number): string {
  return String(n).padStart(4, '0');
}

type TxSettings = {
  systemSettings: { findUnique: Function; upsert: Function };
};

/** Solo lectura: siguiente correlativo que se asignará al guardar (no incrementa). */
export async function peekNextExchangeSerial(prisma: {
  systemSettings: { findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null> };
}): Promise<{ shippingRegistryNumber: string; exchangeReceiptNumber: string }> {
  const year = new Date().getFullYear();
  const key = seqKey(year);
  const row = await prisma.systemSettings.findUnique({ where: { key } });
  const next = (row?.value ? parseInt(String(row.value), 10) : 0) + 1;
  const p = padSeq(next);
  return {
    shippingRegistryNumber: `ENV-${year}-${p}`,
    exchangeReceiptNumber: `CAM-${year}-${p}`,
  };
}

/**
 * Incrementa el contador una sola vez y devuelve ENV + CAM con el mismo sufijo numérico.
 */
export async function allocateExchangeConsecutives(
  tx: TxSettings
): Promise<{ shippingRegistryNumber: string; exchangeReceiptNumber: string }> {
  const year = new Date().getFullYear();
  const key = seqKey(year);
  const row = await tx.systemSettings.findUnique({ where: { key } });
  const next = (row?.value ? parseInt(String(row.value), 10) : 0) + 1;
  await tx.systemSettings.upsert({
    where: { key },
    update: { value: String(next), updatedAt: new Date() },
    create: {
      key,
      value: String(next),
      description: `Contador N° registro envío / CAM cambios ${year}`,
    },
  });
  const p = padSeq(next);
  return {
    shippingRegistryNumber: `ENV-${year}-${p}`,
    exchangeReceiptNumber: `CAM-${year}-${p}`,
  };
}

/** @deprecated Usar allocateExchangeConsecutives; se mantiene por si algún script lo importaba. */
export async function allocateNextExchangeShippingRegistryNumber(tx: TxSettings): Promise<string> {
  const { shippingRegistryNumber } = await allocateExchangeConsecutives(tx);
  return shippingRegistryNumber;
}
