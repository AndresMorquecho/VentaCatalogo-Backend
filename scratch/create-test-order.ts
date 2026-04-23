
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const clientId = "5b73d481-de42-43a5-b983-5ba61a563433";
  const brandId = "25e92a0b-af7a-485c-be48-f6b39ff7e4e3";
  const bankAccountId = "cash-account-1";
  
  const total = 103.83;
  const deposit = 50.11;
  const pending = 53.72; // 103.83 - 50.11 = 53.72

  const receiptNumber = `TEST-${crypto.randomUUID().slice(0, 6)}`.toUpperCase();
  const orderNumber = `PD-2026-TEST-${crypto.randomUUID().slice(0, 4)}`.toUpperCase();

  try {
    console.log(`Creating test order ${orderNumber} for receipt ${receiptNumber}...`);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Receipt
      const receipt = await tx.orderReceipt.create({
        data: {
          receiptNumber,
          clientId,
          clientName: "ANDRES MORQUECHO SEVILLLANO",
          salesChannel: "OFICINA",
          transactionDate: new Date(),
          paymentMethod: "EFECTIVO",
          bankAccountId,
          createdByName: "admin-tester",
          notes: "Pedido de prueba para validar decimales 103.83"
        }
      });

      // 2. Create Order
      const order = await tx.order.create({
        data: {
          receiptId: receipt.id,
          receiptNumber,
          orderNumber,
          clientId,
          clientName: "ANDRES MORQUECHO SEVILLLANO",
          brandId,
          total,
          type: "PEDIDO",
          status: "POR_RECIBIR",
          salesChannel: "OFICINA",
          paymentMethod: "EFECTIVO",
          bankAccountId,
          transactionDate: new Date(),
          possibleDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdByName: "admin-tester"
        }
      });

      // 3. Create Item
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          productName: "Producto Prueba Decimales",
          quantity: 1,
          unitPrice: total,
          brandId,
          brandName: "Belcorp"
        }
      });

      // 4. Create Payment (Abono Inicial)
      const payment = await tx.orderPayment.create({
        data: {
          orderId: order.id,
          amount: deposit,
          method: "EFECTIVO",
          receiptNumber: `AB-${crypto.randomUUID().slice(0, 6)}`.toUpperCase(),
          description: "Abono inicial prueba decimales"
        }
      });

      // 5. Create Financial Record
      await tx.financialRecord.create({
        data: {
          type: "PAYMENT",
          source: "ORDER_PAYMENT",
          movementType: "INCOME",
          referenceNumber: `FIN-TEST-${crypto.randomUUID().slice(0, 8)}`.toUpperCase(),
          amount: deposit,
          date: new Date(),
          clientId,
          clientName: "ANDRES MORQUECHO SEVILLLANO",
          bankAccountId,
          orderId: order.id,
          orderPaymentId: payment.id,
          createdBy: "admin-tester",
          notes: `Abono inicial test | Orden: ${receiptNumber} | Pedido: ${orderNumber}`
        }
      });

      // 6. Update Bank Balance
      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: { increment: deposit }, version: { increment: 1 } }
      });

      return { receiptNumber, orderNumber, total, deposit, pending };
    });

    console.log("Success! Test order created:");
    console.log(JSON.stringify(result, null, 2));
    console.log("\nNow you can check this order in the app and try to pay the remaining $53.72.");

  } catch (error) {
    console.error("Error creating test order:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
