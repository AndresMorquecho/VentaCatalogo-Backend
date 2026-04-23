
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const clientId = "5b73d481-de42-43a5-b983-5ba61a563433";
  const brandId = "25e92a0b-af7a-485c-be48-f6b39ff7e4e3";
  const bankAccountId = "cash-account-1";
  
  // Dirty floating point numbers
  const total = 125.83000000000000233;
  const deposit = 25.11999999999999999;
  
  // Note: Prisma and Postgres will round these to 2 decimals (125.83 and 25.12)
  // because the column is Decimal(10,2). 
  // We want to see if the app displays them cleanly.

  const receiptNumber = `DIRTY-${crypto.randomUUID().slice(0, 6)}`.toUpperCase();
  const orderNumber = `PD-DIRTY-${crypto.randomUUID().slice(0, 4)}`.toUpperCase();

  try {
    console.log(`Creating "dirty" decimal order ${orderNumber}...`);

    const result = await prisma.$transaction(async (tx) => {
      const receipt = await tx.orderReceipt.create({
        data: {
          receiptNumber,
          clientId,
          clientName: "ANDRES MORQUECHO SEVILLLANO",
          salesChannel: "OFICINA",
          transactionDate: new Date(),
          paymentMethod: "EFECTIVO",
          bankAccountId,
          createdByName: "dirty-tester",
          notes: `Prueba con decimales sucios: Total ${total}, Abono ${deposit}`
        }
      });

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
          createdByName: "dirty-tester"
        }
      });

      const payment = await tx.orderPayment.create({
        data: {
          orderId: order.id,
          amount: deposit,
          method: "EFECTIVO",
          receiptNumber: `AB-D-${crypto.randomUUID().slice(0, 5)}`.toUpperCase(),
          description: "Abono sucio"
        }
      });

      await tx.financialRecord.create({
        data: {
          type: "PAYMENT",
          source: "ORDER_PAYMENT",
          movementType: "INCOME",
          referenceNumber: `FIN-DIRTY-${crypto.randomUUID().slice(0, 6)}`.toUpperCase(),
          amount: deposit,
          date: new Date(),
          clientId,
          clientName: "ANDRES MORQUECHO SEVILLLANO",
          bankAccountId,
          orderId: order.id,
          orderPaymentId: payment.id,
          createdBy: "dirty-tester",
          notes: `Abono sucio test | Total real enviado: ${total} | Abono real enviado: ${deposit}`
        }
      });

      return { receiptNumber, orderNumber, sentTotal: total, sentDeposit: deposit };
    });

    console.log("Success! Dirty decimal order created:");
    console.log(JSON.stringify(result, null, 2));
    console.log("\nIn the DB (Decimal 10,2), these will be stored as:");
    console.log(`Total: 125.83`);
    console.log(`Abono: 25.12`);
    console.log(`Saldo Pendiente esperado: 100.71`);

  } catch (error) {
    console.error("Error creating dirty order:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
