import { prisma } from '../src/lib/prisma';
import { BatchDeliverOrdersUseCase } from '../src/features/orders/application/BatchDeliverOrders.usecase';

const batchDeliverUseCase = new BatchDeliverOrdersUseCase();

async function runTests() {
  console.log('🚀 Iniciando validación de escenarios complejos de entrega...\n');

  try {
    // 1. Setup Test Client
    const client = await prisma.client.upsert({
      where: { identificationNumber: 'VERIFY-FIN-001' },
      update: {},
      create: {
        identificationType: 'CEDULA',
        identificationNumber: 'VERIFY-FIN-001',
        firstName: 'VALIDACION FINANCIERA',
        email: 'test@verify.com',
        phone1: '0991234567',
        operator1: 'CLARO',
        country: 'Ecuador',
        province: 'Guayas',
        city: 'Guayaquil',
        address: 'Test'
      }
    });

    const clientAccount = await prisma.clientAccount.upsert({
      where: { clientId: client.id },
      update: { totalCreditAvailable: 0 },
      create: {
        clientId: client.id,
        totalCreditAvailable: 0,
        totalRewardPoints: 0,
        totalOrders: 0,
        totalSpent: 0,
        rewardLevel: 'BRONCE'
      }
    });

    const brand = await prisma.brand.findFirst();
    const cashAccount = await prisma.bankAccount.findFirst({ where: { type: 'CASH' } });

    if (!brand || !cashAccount) {
      throw new Error('Faltan datos base (Marca/Caja) en la DB');
    }

    // ENSURE ENOUGH FUNDS FOR REFUND
    if (Number(cashAccount.currentBalance) < 100) {
        console.log('💰 Fondeando caja para pruebas de devolución...');
        await prisma.bankAccount.update({
            where: { id: cashAccount.id },
            data: { currentBalance: 1000 }
        });
    }

    console.log('✅ Entorno preparado.');

    // 2. Create 4 Orders with surplus
    const sourceOrderIds: string[] = [];
    console.log('📦 Creando pedidos con saldo a favor...');
    for (let i = 1; i <= 4; i++) {
        const order = await prisma.order.create({
            data: {
                receiptNumber: `SRC-${i}-${Date.now()}`,
                orderNumber: `PD-SRC-${i}-${Date.now()}`,
                clientId: client.id,
                clientName: client.firstName,
                brandId: brand.id,
                total: 20,
                status: 'RECIBIDO_EN_BODEGA',
                realInvoiceTotal: 10,
                transactionDate: new Date(),
                possibleDeliveryDate: new Date(),
                salesChannel: 'WHATSAPP',
                type: 'NORMAL',
                paymentMethod: 'EFECTIVO'
            }
        });
        
        await prisma.orderPayment.create({
            data: {
                orderId: order.id,
                amount: 20,
                method: 'EFECTIVO',
                description: 'Pago completo'
            }
        });
        
        sourceOrderIds.push(order.id);
    }

    // 3. Create 2 Destination Orders
    console.log('📦 Creando pedidos con saldo pendiente...');
    const targetOrderIds: string[] = [];
    for (let i = 1; i <= 2; i++) {
        const order = await prisma.order.create({
            data: {
                receiptNumber: `TGT-${i}-${Date.now()}`,
                orderNumber: `PD-TGT-${i}-${Date.now()}`,
                clientId: client.id,
                clientName: client.firstName,
                brandId: brand.id,
                total: 15,
                status: 'RECIBIDO_EN_BODEGA',
                transactionDate: new Date(),
                possibleDeliveryDate: new Date(),
                salesChannel: 'WHATSAPP',
                type: 'NORMAL',
                paymentMethod: 'EFECTIVO'
            }
        });
        targetOrderIds.push(order.id);
    }

    // 4. PREPARE PAYLOAD
    const payload = {
        orderIds: [targetOrderIds[0], targetOrderIds[1]],
        payments: [{ amount: 5, paymentMethod: 'EFECTIVO' }],
        creditDistributions: [
            { sourceOrderId: sourceOrderIds[0], totalCreditAmount: 10, distributions: [{ targetOrderId: targetOrderIds[0], amount: 10, description: 'Dist1' }] },
            { sourceOrderId: sourceOrderIds[1], totalCreditAmount: 10, distributions: [{ targetOrderId: targetOrderIds[0], amount: 5, description: 'Dist2' }, { amount: 5, description: 'A Billetera', isCashReturn: false }] },
            { sourceOrderId: sourceOrderIds[2], totalCreditAmount: 10, distributions: [{ targetOrderId: targetOrderIds[1], amount: 10, description: 'Dist3' }] },
            { sourceOrderId: sourceOrderIds[3], totalCreditAmount: 10, distributions: [{ amount: 10, description: 'Devolucion Efectivo', isCashReturn: true, bankAccountId: cashAccount.id }] }
        ]
    };

    console.log('🧪 Ejecutando BatchDeliverOrders...');
    const result = await batchDeliverUseCase.execute(payload as any, 'system-tester');

    if (!result.success) {
        console.error('❌ Error en BatchDeliverOrders:', JSON.stringify(result, null, 2));
        process.exit(1);
    }

    console.log('✅ BatchDeliverOrders completado con éxito.');

    // 5. VALIDATIONS
    console.log('\n🔍 Validando resultados financieros...');
    const updatedAccount = await prisma.clientAccount.findUnique({ where: { id: clientAccount.id } });
    console.log(`- Saldo Final Billetera: $${updatedAccount?.totalCreditAvailable} (Esperado: $5)`);

    const records = await prisma.financialRecord.findMany({
        where: { clientId: client.id },
        orderBy: { date: 'asc' }
    });

    console.log('\n📊 Detalle de Balances (Movimientos de Distribución):');
    records.filter(r => r.source === 'CREDIT_DISTRIBUTION' || r.source === 'CASH_RETURN').forEach(r => {
        console.log(`  [${r.type}] ${r.movementType} | $${r.amount} | Antes: ${r.balanceBefore} | Después: ${r.balanceAfter} | Notas: ${r.notes}`);
    });

    console.log('\n✨ Validación finalizada.');

  } catch (err) {
    console.error('❌ Error fatal:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
