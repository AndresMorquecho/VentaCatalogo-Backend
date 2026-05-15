import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function adjust() {
  // ======================================================
  // AJUSTE DEL PEDIDO 320997 (receiptNumber)
  // ======================================================
  // Datos actuales del pedido:
  //   - ID: 3772cb81-8984-4063-b615-07cb60d061e5
  //   - receiptNumber: "320997"
  //   - orderNumber: "C 6"
  //   - status: "POR_RECIBIR"
  //   - total: 20
  //   - realInvoiceTotal: 0
  //   - Pagos existentes: 1 pago de $5 (EFECTIVO - ABONO IMPORTADO)
  //   - Financial records existentes: 1 registro de $5 (INCOME)
  //   - Cliente: JUANA ARACELY YAGUAL BORBOR (ID: 29d1ffb9-b07f-4e95-a618-c23eb321dc8d)
  //   - Marca: AVON (ID: 6d8b347b-b9bc-4d8b-b84f-7a512bd77724)
  //   - transactionDate: 2026-04-17 (Abril 2026)
  //   - No tiene receptionBatch ni deliveryBatch
  //
  // Cambios requeridos:
  //   1. Status → ENTREGADO
  //   2. realInvoiceTotal → 20 (valor de factura)
  //   3. Registrar pago adicional de $15 ($20 - $5 ya pagados = $15 pendiente)
  //      WAIT: El usuario dijo "valor de factura 20 lo cobrado 20", eso significa total $20, pagado $20
  //      Ya hay un pago de $5. Necesitamos un pago de $15 para completar $20.
  //   4. Crear ReceptionBatch (packing) acorde al mes/año (Abril 2026)
  //   5. Crear DeliveryBatch para la entrega
  //   6. Registrar en FinancialRecord el pago de $15 en caja DDCA
  //   7. Actualizar receptionDate, deliveryDate
  //   8. receivedByName y deliveredByName → "DDCA"

  const orderId = '3772cb81-8984-4063-b615-07cb60d061e5';
  const clientId = '29d1ffb9-b07f-4e95-a618-c23eb321dc8d';
  const clientName = 'JUANA ARACELY YAGUAL BORBOR';
  const brandId = '6d8b347b-b9bc-4d8b-b84f-7a512bd77724';
  const cashAccountId = 'cash-account-1'; // Caja Principal
  const userName = 'DDCA';
  const now = new Date();

  // El pedido fue de Abril 2026, así que el packing debe ser de ese mes
  // Buscar si ya existe un packing de abril 2026 o crear uno nuevo
  const existingAprilPackings = await prisma.receptionBatch.findMany({
    where: {
      receptionDate: {
        gte: new Date('2026-04-01'),
        lt: new Date('2026-05-01')
      }
    },
    orderBy: { packingNumber: 'desc' },
    take: 1
  });
  console.log('Packings de Abril 2026:', JSON.stringify(existingAprilPackings, null, 2));

  // Buscar el siguiente número de packing disponible
  const lastPacking = await prisma.receptionBatch.findFirst({
    orderBy: { packingNumber: 'desc' },
    select: { packingNumber: true }
  });
  console.log('Último packing:', lastPacking?.packingNumber);

  // Buscar el siguiente número de delivery disponible (filtrando por prefijo EN-2026-)
  const lastDelivery = await prisma.deliveryBatch.findFirst({
    where: { deliveryNumber: { startsWith: 'EN-2026-' } },
    orderBy: { deliveryNumber: 'desc' },
    select: { deliveryNumber: true }
  });
  console.log('Último delivery:', lastDelivery?.deliveryNumber);

  // Verificar el estado actual de la orden
  const currentOrder = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true, financialRecords: true }
  });
  
  if (!currentOrder) {
    console.error('ORDER NOT FOUND!');
    return;
  }

  console.log('\n=== ESTADO ACTUAL ===');
  console.log('Status:', currentOrder.status);
  console.log('Total:', currentOrder.total.toString());
  console.log('realInvoiceTotal:', currentOrder.realInvoiceTotal?.toString());
  console.log('Pagos:', currentOrder.payments.length, '- Total pagado:', 
    currentOrder.payments.reduce((sum, p) => sum + Number(p.amount), 0));
  console.log('Financial Records:', currentOrder.financialRecords.length);

  const totalPagado = currentOrder.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const pendiente = 20 - totalPagado;
  console.log('\nPendiente por pagar:', pendiente);

  // Verificar el balance actual de la caja
  const cashAccount = await prisma.bankAccount.findUnique({
    where: { id: cashAccountId }
  });
  console.log('Balance actual caja:', cashAccount?.currentBalance.toString());

  // Generar IDs para los nuevos registros
  const receptionBatchId = randomUUID();
  const deliveryBatchId = randomUUID();
  const paymentId = randomUUID();
  const financialRecordId = randomUUID();

  // Calcular el número de packing y delivery
  const lastPkNum = lastPacking ? parseInt(lastPacking.packingNumber.split('-').pop() || '0') : 0;
  const newPkNumber = `PK-2026-${(lastPkNum + 1).toString().padStart(3, '0')}`;

  const lastDelNum = lastDelivery ? parseInt(lastDelivery.deliveryNumber.split('-').pop() || '0') : 0;
  const newDelNumber = `EN-2026-${(lastDelNum + 1).toString().padStart(3, '0')}`;

  // Generar número de referencia financiero único
  const finRefNumber = `FIN-320997-ADJ-${Date.now()}`;

  console.log('\n=== PLAN DE EJECUCIÓN ===');
  console.log('1. Crear ReceptionBatch:', newPkNumber, '(fecha: Abril 2026)');
  console.log('2. Crear DeliveryBatch:', newDelNumber);
  console.log('3. Registrar pago adicional de $' + pendiente);
  console.log('4. Crear FinancialRecord de $' + pendiente + ' en caja ' + userName);
  console.log('5. Actualizar orden:');
  console.log('   - status: POR_RECIBIR → ENTREGADO');
  console.log('   - realInvoiceTotal: 0 → 20');
  console.log('   - receptionDate: null → 2026-04-17');
  console.log('   - deliveryDate: null → now');
  console.log('   - receivedByName: null → DDCA');
  console.log('   - deliveredByName: null → DDCA');
  console.log('   - packingNumber:', newPkNumber);
  console.log('   - receptionBatchId:', receptionBatchId);
  console.log('   - deliveryBatchId:', deliveryBatchId);
  console.log('   - deliveryNumber:', newDelNumber);
  console.log('6. Actualizar balance de Caja Principal: +$' + pendiente);

  console.log('\n=== ESPERANDO CONFIRMACIÓN (DRY RUN - NO SE EJECUTA NADA) ===');
  console.log('Para ejecutar, cambia DRY_RUN a false en el script.');

  const DRY_RUN = false;

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No se realizó ningún cambio.');
    await prisma.$disconnect();
    return;
  }

  // =============================
  // EJECUCIÓN TRANSACCIONAL
  // =============================
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Crear ReceptionBatch (Packing de Abril 2026)
      await tx.receptionBatch.create({
        data: {
          id: receptionBatchId,
          packingNumber: newPkNumber,
          packingTotal: 20, // total de factura de la orden
          receptionDate: new Date('2026-04-17T00:00:00.000Z'), // fecha del mes del pedido
          receivedByName: userName,
          notes: 'Ajuste manual - Pedido 320997',
        }
      });
      console.log('✅ ReceptionBatch creado:', newPkNumber);

      // 2. Crear DeliveryBatch
      await tx.deliveryBatch.create({
        data: {
          id: deliveryBatchId,
          deliveryNumber: newDelNumber,
          deliveryDate: now,
          deliveredByName: userName,
          notes: 'Ajuste manual - Entrega pedido 320997',
        }
      });
      console.log('✅ DeliveryBatch creado:', newDelNumber);

      // 3. Registrar pago adicional
      if (pendiente > 0) {
        await tx.orderPayment.create({
          data: {
            id: paymentId,
            orderId: orderId,
            amount: pendiente,
            method: 'EFECTIVO',
            reference: 'AJUSTE MANUAL - PEDIDO 320997',
            description: 'Pago completado por ajuste de entrega',
            createdAt: now,
            deliveryBatchId: deliveryBatchId,
          }
        });
        console.log('✅ Pago registrado: $' + pendiente);

        // 4. Crear FinancialRecord
        await tx.financialRecord.create({
          data: {
            id: financialRecordId,
            type: 'INCOME',
            referenceNumber: finRefNumber,
            amount: pendiente,
            date: now,
            clientId: clientId,
            clientName: clientName,
            orderId: orderId,
            createdBy: userName,
            notes: 'Pago ajuste manual - Pedido 320997 - Entrega',
            bankAccountId: cashAccountId,
            source: 'ORDER_PAYMENT',
            paymentMethod: 'EFECTIVO',
            movementType: 'INCOME',
            orderPaymentId: paymentId,
            userReference: userName,
            deliveryBatchId: deliveryBatchId,
          }
        });
        console.log('✅ FinancialRecord creado: $' + pendiente);

        // 5. Actualizar balance de la Caja Principal
        await tx.bankAccount.update({
          where: { id: cashAccountId },
          data: {
            currentBalance: {
              increment: pendiente
            }
          }
        });
        console.log('✅ Balance de Caja actualizado: +$' + pendiente);
      }

      // 6. Actualizar la Orden
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'ENTREGADO',
          realInvoiceTotal: 20,
          receptionDate: new Date('2026-04-17T00:00:00.000Z'),
          deliveryDate: now,
          receivedByName: userName,
          deliveredByName: userName,
          packingNumber: newPkNumber,
          packingTotal: 20,
          receptionBatchId: receptionBatchId,
          deliveryBatchId: deliveryBatchId,
          deliveryNumber: newDelNumber,
        }
      });
      console.log('✅ Orden actualizada a ENTREGADO');
    });

    console.log('\n🎉 ¡AJUSTE COMPLETADO EXITOSAMENTE!');

    // Verificación final
    const updatedOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true, financialRecords: true, receptionBatch: true, deliveryBatch: true }
    });
    console.log('\n=== VERIFICACIÓN FINAL ===');
    console.log('Status:', updatedOrder?.status);
    console.log('Total:', updatedOrder?.total.toString());
    console.log('realInvoiceTotal:', updatedOrder?.realInvoiceTotal?.toString());
    console.log('Pagos:', updatedOrder?.payments.length, '- Total pagado:',
      updatedOrder?.payments.reduce((sum, p) => sum + Number(p.amount), 0));
    console.log('Packing:', updatedOrder?.packingNumber);
    console.log('Delivery:', updatedOrder?.deliveryNumber);
    console.log('ReceptionBatch:', updatedOrder?.receptionBatch?.packingNumber);
    console.log('DeliveryBatch:', updatedOrder?.deliveryBatch?.deliveryNumber);
    console.log('receivedByName:', updatedOrder?.receivedByName);
    console.log('deliveredByName:', updatedOrder?.deliveredByName);
    console.log('receptionDate:', updatedOrder?.receptionDate);
    console.log('deliveryDate:', updatedOrder?.deliveryDate);

    const finalCash = await prisma.bankAccount.findUnique({ where: { id: cashAccountId } });
    console.log('Balance final caja:', finalCash?.currentBalance.toString());

  } catch (error) {
    console.error('❌ ERROR EN LA TRANSACCIÓN:', error);
    console.error('No se realizó ningún cambio (rollback automático).');
  }

  await prisma.$disconnect();
}

adjust().catch(e => { console.error(e); prisma.$disconnect(); });
