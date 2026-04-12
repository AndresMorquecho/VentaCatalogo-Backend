/**
 * Secuencial para PDF "Guía de envío" de cambios (independiente del CAM del recibo).
 * Formato: Guia-AAAA-NNN
 */
type TxSettings = {
  systemSettings: { findUnique: Function; upsert: Function };
};

export async function allocateNextExchangeShippingGuideSerial(tx: TxSettings): Promise<string> {
  const year = new Date().getFullYear();
  const key = `SEQ_EXCHANGE_GUIA_${year}`;
  const row = await tx.systemSettings.findUnique({ where: { key } });
  const next = (row?.value ? parseInt(String(row.value), 10) : 0) + 1;
  await tx.systemSettings.upsert({
    where: { key },
    update: { value: String(next), updatedAt: new Date() },
    create: {
      key,
      value: String(next),
      description: `Contador guía envío cambios ${year} (PDF)`,
    },
  });
  return `Guia-${year}-${String(next).padStart(3, '0')}`;
}
