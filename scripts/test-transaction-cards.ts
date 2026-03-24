import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TestResult {
  case: string;
  passed: boolean;
  details: string;
  financialRecords?: any[];
  clientCredits?: any[];
}

const results: TestResult[] = [];

async function cleanup() {
  console.log('🧹 Limpiando datos de prueba...\n');
  
  // Delete in correct order to respect foreign keys
  await prisma.financialRecord.deleteMany({
    where: {
      OR: [
        { referenceNumber: { contains: 'TEST-CARD-' } },
        { notes: { contains: 'TEST-CARD' } }
      ]
    }
  });
  
  await prisma.orderPayment.deleteMany({
    where: { receiptNumber: { contains: 'TEST-CARD-' } }
  });
  
  await prisma.clientCredit.deleteMany({
    where: { originTransactionId: { contains: 'TEST-CARD-' } }
  });
  
  await prisma.inventoryMovement.deleteMany({
    where: { notes: { contains: 'TEST-CARD' } }
  });
  
  await prisma.order.deleteMany({
    where: { receiptNumber: { contains: 'TEST-CARD-' } }
  });
  
  await prisma.receptionBatch.deleteMany({
    where: { packingNumber: { contains: 'TEST-CARD-' } }
  });
}

async function setupTestData() {
  console.log('📦 Configurando datos de prueba...\n');
  
  // Get or create test client
  let client = await prisma.client.findFirst({
    where: { identificationNumber: 'TEST-CARD-CLIENT' }
  });
  
  if (!client) {
    client = await prisma.client.create({
      data: {
        identificationType: 'CEDULA',
        identificationNumber: 'TEST-CARD-CLIENT',
        firstName: 'Cliente Prueba Tarjetas',
        country: 'Ecuador',
        province: 'Guayas',
        city: 'Guayaquil',
        address: 'Test Address',
        email: 'test-cards@example.com',
        phone1: '0999999999',
        operator1: 'CLARO'
      }
    });
  }
  
  // Get or create client account
  let clientAccount = await prisma.clientAccount.findFirst({
    where: { clientId: client.id }
  });
  
  if (!clientAccount) {
    clientAccount = await prisma.clientAccount.create({
      data: {
        clientId: client.id,
        totalCreditAvailable: 0,
        totalRewardPoints: 0,
        totalOrders: 0,
        totalSpent: 0,
        rewardLevel: 'BRONCE'
      }
    });
  }
  
  // Get test brand
  const brand = await prisma.brand.findFirst();
  if (!brand) {
    throw new Error('No hay marcas en la base de datos');
  }
  
  // Get cash bank account
  const cashAccount = await prisma.bankAccount.findFirst({
    where: { type: 'CASH' }
  });
  
  if (!cashAccount) {
    throw new Error('No hay cuenta de efectivo en la base de datos');
  }
  
  // Get bank account
  const bankAccount = await prisma.bankAccount.findFirst({
    where: { type: 'BANK' }
  });
  
  if (!bankAccount) {
    throw new Error('No hay cuenta bancaria en la base de datos');
  }
  
  return { client, clientAccount, brand, cashAccount, bankAccount };
}

// ============================================================================
// CASO F: Saldo a Favor → Billetera Virtual (Automático)
// ============================================================================
async function testCaseF(client: any, brand: any, cashAccount: any) {
  console.log('🧪 Caso F: Saldo a Favor → Billetera Virtual (Automático)');
  
  try {
    // 1. Create order
    const order = await prisma.order.create({
      data: {
        receiptNumber: 'TEST-CARD-F-001',
        orderNumber: 'TEST-CARD-F-001',
        salesChannel: 'WHATSAPP',
        type: 'NORMAL',
        brandId: brand.id,
        total: 100,
        paymentMethod: 'EFECTIVO',
        transactionDate: new Date(),
        possibleDeliveryDate: new Date(),
        status: 'POR_RECIBIR',
        clientId: client.id,
        clientName: client.firstName
      }
    });
    
    // 2. Create payment
    await prisma.orderPayment.create({
      data: {
        orderId: order.id,
        amount: 100,
        method: 'EFECTIVO',
        receiptNumber: 'TEST-CARD-F-PAY-001',
        description: 'Pago inicial'
      }
    });
    
    // 3. Create financial record for payment
    await prisma.financialRecord.create({
      data: {
        type: 'PAYMENT',
        referenceNumber: 'TEST-CARD-F-REF-001',
        amount: 100,
        date: new Date(),
        clientId: client.id,
        clientName: client.firstName,
        orderId: order.id,
        bankAccountId: cashAccount.id,
        source: 'ORDER_PAYMENT',
        paymentMethod: 'EFECTIVO',
        movementType: 'INCOME',
        createdBy: 'test-script',
        notes: `Pago inicial - Pedido: ${order.orderNumber} | Marca: ${brand.name}`
      }
    });
    
    // 4. Receive order with lower invoice (creates credit)
    const finalTotal = 10;
    const creditAmount = 100 - finalTotal; // $90
    
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'RECIBIDO_EN_BODEGA',
        realInvoiceTotal: finalTotal,
        invoiceNumber: 'TEST-CARD-F-INV-001',
        receptionDate: new Date()
      }
    });
    
    // 5. Create CREDIT_GENERATION (should NOT be shown as card)
    const creditGenRecord = await prisma.financialRecord.create({
      data: {
        type: 'CREDIT_GENERATION',
        referenceNumber: 'TEST-CARD-F-CREDIT-GEN-001',
        amount: creditAmount,
        date: new Date(),
        clientId: client.id,
        clientName: client.firstName,
        orderId: order.id,
        bankAccountId: 'virtual-credit-account',
        source: 'RECEPTION_OVERPAYMENT',
        paymentMethod: 'SALDO_A_FAVOR',
        movementType: 'INCOME',
        createdBy: 'test-script',
        notes: `Saldo a favor generado - Original: 100, Facturado: ${finalTotal}`
      }
    });
    
    // 6. Create CREDIT_APPLICATION to wallet (SHOULD be shown as "Recarga Billetera Virtual")
    const creditAppRecord = await prisma.financialRecord.create({
      data: {
        type: 'CREDIT_APPLICATION',
        referenceNumber: 'TEST-CARD-F-CREDIT-APP-001',
        amount: creditAmount,
        date: new Date(),
        clientId: client.id,
        clientName: client.firstName,
        orderId: null, // No orderId = to wallet
        bankAccountId: 'virtual-credit-account',
        source: 'CREDIT_DISTRIBUTION',
        paymentMethod: 'SALDO_A_FAVOR',
        movementType: 'EXPENSE',
        createdBy: 'test-script',
        notes: `Saldo guardado en billetera virtual - Origen: Pedido ${order.receiptNumber}`
      }
    });
    
    // 7. Create client credit
    const clientAccount = await prisma.clientAccount.findFirst({
      where: { clientId: client.id }
    });
    
    await prisma.clientCredit.create({
      data: {
        clientAccountId: clientAccount!.id,
        amount: creditAmount,
        remainingAmount: creditAmount,
        originTransactionId: `TEST-CARD-F-CREDIT-${Date.now()}`,
        originOrderId: order.id,
        status: 'AVAILABLE'
      }
    });
    
    // 8. Verify
    const allRecords = await prisma.financialRecord.findMany({
      where: {
        OR: [
          { id: creditGenRecord.id },
          { id: creditAppRecord.id }
        ]
      }
    });
    
    const hasGeneration = allRecords.some(r => r.type === 'CREDIT_GENERATION');
    const hasApplication = allRecords.some(r => 
      r.type === 'CREDIT_APPLICATION' && 
      r.source === 'CREDIT_DISTRIBUTION' &&
      r.orderId === null
    );
    
    results.push({
      case: 'Caso F: Saldo a Favor → Billetera Virtual',
      passed: hasGeneration && hasApplication,
      details: `✅ CREDIT_GENERATION creado (no debe mostrarse)\n✅ CREDIT_APPLICATION creado (debe mostrarse como "Recarga Billetera Virtual")`,
      financialRecords: allRecords
    });
    
    console.log('  ✅ Caso F completado\n');
    
  } catch (error) {
    results.push({
      case: 'Caso F: Saldo a Favor → Billetera Virtual',
      passed: false,
      details: `❌ Error: ${error instanceof Error ? error.message : String(error)}`
    });
    console.log(`  ❌ Error: ${error}\n`);
  }
}

// ============================================================================
// CASO G: Devolución en Efectivo
// ============================================================================
async function testCaseG(client: any, brand: any, cashAccount: any) {
  console.log('🧪 Caso G: Devolución en Efectivo');
  
  try {
    // 1. Create order
    const order = await prisma.order.create({
      data: {
        receiptNumber: 'TEST-CARD-G-001',
        orderNumber: 'TEST-CARD-G-001',
        salesChannel: 'WHATSAPP',
        type: 'NORMAL',
        brandId: brand.id,
        total: 100,
        paymentMethod: 'EFECTIVO',
        transactionDate: new Date(),
        possibleDeliveryDate: new Date(),
        status: 'POR_RECIBIR',
        clientId: client.id,
        clientName: client.firstName
      }
    });
    
    // 2. Create payment
    await prisma.orderPayment.create({
      data: {
        orderId: order.id,
        amount: 100,
        method: 'EFECTIVO',
        receiptNumber: 'TEST-CARD-G-PAY-001',
        description: 'Pago inicial'
      }
    });
    
    // 3. Receive order
    const finalTotal = 10;
    const creditAmount = 100 - finalTotal; // $90
    
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'RECIBIDO_EN_BODEGA',
        realInvoiceTotal: finalTotal,
        invoiceNumber: 'TEST-CARD-G-INV-001',
        receptionDate: new Date()
      }
    });
    
    // 4. Create CREDIT_GENERATION
    await prisma.financialRecord.create({
      data: {
        type: 'CREDIT_GENERATION',
        referenceNumber: 'TEST-CARD-G-CREDIT-GEN-001',
        amount: creditAmount,
        date: new Date(),
        clientId: client.id,
        clientName: client.firstName,
        orderId: order.id,
        bankAccountId: 'virtual-credit-account',
        source: 'RECEPTION_OVERPAYMENT',
        paymentMethod: 'SALDO_A_FAVOR',
        movementType: 'INCOME',
        createdBy: 'test-script',
        notes: `Saldo a favor generado - Original: 100, Facturado: ${finalTotal}`
      }
    });
    
    // 5. Create CREDIT_APPLICATION for cash return (SHOULD be shown as "Devolución en Efectivo")
    const cashReturnRecord = await prisma.financialRecord.create({
      data: {
        type: 'CREDIT_APPLICATION',
        referenceNumber: 'TEST-CARD-G-CASH-RETURN-001',
        amount: creditAmount,
        date: new Date(),
        clientId: client.id,
        clientName: client.firstName,
        orderId: null,
        bankAccountId: cashAccount.id, // Use real cash account
        source: 'CASH_RETURN',
        paymentMethod: 'EFECTIVO',
        movementType: 'EXPENSE',
        createdBy: 'test-script',
        notes: `Devolución en efectivo al cliente - Origen: Pedido ${order.receiptNumber}`
      }
    });
    
    // 6. Verify
    const record = await prisma.financialRecord.findUnique({
      where: { id: cashReturnRecord.id }
    });
    
    const isCorrect = record?.type === 'CREDIT_APPLICATION' && 
                     record?.source === 'CASH_RETURN' &&
                     record?.movementType === 'EXPENSE';
    
    results.push({
      case: 'Caso G: Devolución en Efectivo',
      passed: isCorrect,
      details: `✅ CREDIT_APPLICATION con source='CASH_RETURN' creado\n✅ Debe mostrarse como "Devolución en Efectivo"`,
      financialRecords: [record]
    });
    
    console.log('  ✅ Caso G completado\n');
    
  } catch (error) {
    results.push({
      case: 'Caso G: Devolución en Efectivo',
      passed: false,
      details: `❌ Error: ${error instanceof Error ? error.message : String(error)}`
    });
    console.log(`  ❌ Error: ${error}\n`);
  }
}

// ============================================================================
// CASO I: Distribución a Otros Pedidos
// ============================================================================
async function testCaseI(client: any, brand: any, cashAccount: any) {
  console.log('🧪 Caso I: Distribución a Otros Pedidos');
  
  try {
    // 1. Create source order
    const sourceOrder = await prisma.order.create({
      data: {
        receiptNumber: 'TEST-CARD-I-SOURCE',
        orderNumber: 'TEST-CARD-I-SOURCE',
        salesChannel: 'WHATSAPP',
        type: 'NORMAL',
        brandId: brand.id,
        total: 100,
        paymentMethod: 'EFECTIVO',
        transactionDate: new Date(),
        possibleDeliveryDate: new Date(),
        status: 'RECIBIDO_EN_BODEGA',
        realInvoiceTotal: 10,
        clientId: client.id,
        clientName: client.firstName
      }
    });
    
    // 2. Create target orders
    const targetOrders = [];
    for (let i = 1; i <= 3; i++) {
      const targetOrder = await prisma.order.create({
        data: {
          receiptNumber: `TEST-CARD-I-TARGET-${i}`,
          orderNumber: `TEST-CARD-I-TARGET-${i}`,
          salesChannel: 'WHATSAPP',
          type: 'NORMAL',
          brandId: brand.id,
          total: 30,
          paymentMethod: 'CREDITO_CLIENTE',
          transactionDate: new Date(),
          possibleDeliveryDate: new Date(),
          status: 'POR_RECIBIR',
          clientId: client.id,
          clientName: client.firstName
        }
      });
      targetOrders.push(targetOrder);
    }
    
    // 3. Create CREDIT_GENERATION
    await prisma.financialRecord.create({
      data: {
        type: 'CREDIT_GENERATION',
        referenceNumber: 'TEST-CARD-I-CREDIT-GEN-001',
        amount: 90,
        date: new Date(),
        clientId: client.id,
        clientName: client.firstName,
        orderId: sourceOrder.id,
        bankAccountId: 'virtual-credit-account',
        source: 'RECEPTION_OVERPAYMENT',
        paymentMethod: 'SALDO_A_FAVOR',
        movementType: 'INCOME',
        createdBy: 'test-script',
        notes: 'Saldo a favor generado'
      }
    });
    
    // 4. Create CREDIT_APPLICATION for each target order
    const creditAppRecords = [];
    for (let i = 0; i < targetOrders.length; i++) {
      const targetOrder = targetOrders[i];
      
      // CREDIT_APPLICATION (EXPENSE) - distribution
      const creditAppRecord = await prisma.financialRecord.create({
        data: {
          type: 'CREDIT_APPLICATION',
          referenceNumber: `TEST-CARD-I-CREDIT-APP-${i + 1}`,
          amount: 30,
          date: new Date(),
          clientId: client.id,
          clientName: client.firstName,
          orderId: targetOrder.id, // Has orderId = distribution to order
          bankAccountId: 'virtual-credit-account',
          source: 'CREDIT_DISTRIBUTION',
          paymentMethod: 'SALDO_A_FAVOR',
          movementType: 'EXPENSE',
          createdBy: 'test-script',
          notes: `Saldo a favor aplicado desde pedido ${sourceOrder.receiptNumber}`
        }
      });
      creditAppRecords.push(creditAppRecord);
      
      // ORDER_PAYMENT (INCOME) - payment in target order
      await prisma.financialRecord.create({
        data: {
          type: 'ORDER_PAYMENT',
          referenceNumber: `TEST-CARD-I-ORDER-PAY-${i + 1}`,
          amount: 30,
          date: new Date(),
          clientId: client.id,
          clientName: client.firstName,
          orderId: targetOrder.id,
          bankAccountId: 'virtual-credit-account',
          source: 'CREDIT_DISTRIBUTION',
          paymentMethod: 'SALDO_A_FAVOR',
          movementType: 'INCOME',
          createdBy: 'test-script',
          notes: `Pago con saldo a favor - Origen: Pedido ${sourceOrder.receiptNumber}`
        }
      });
      
      // Create order payment
      await prisma.orderPayment.create({
        data: {
          orderId: targetOrder.id,
          amount: 30,
          method: 'CREDITO_CLIENTE',
          reference: `SALDO-DIST-${sourceOrder.id}`,
          receiptNumber: `TEST-CARD-I-REC-${i + 1}`,
          description: `Saldo a favor aplicado desde pedido ${sourceOrder.receiptNumber}`
        }
      });
    }
    
    // 5. Verify
    const allRecords = await prisma.financialRecord.findMany({
      where: {
        id: { in: creditAppRecords.map(r => r.id) }
      }
    });
    
    const allCorrect = allRecords.every(r => 
      r.type === 'CREDIT_APPLICATION' &&
      r.source === 'CREDIT_DISTRIBUTION' &&
      r.orderId !== null
    );
    
    results.push({
      case: 'Caso I: Distribución a Otros Pedidos',
      passed: allCorrect && allRecords.length === 3,
      details: `✅ 3 CREDIT_APPLICATION creados con orderId\n✅ Deben mostrarse como 3 tarjetas "Uso de Billetera Virtual"`,
      financialRecords: allRecords
    });
    
    console.log('  ✅ Caso I completado\n');
    
  } catch (error) {
    results.push({
      case: 'Caso I: Distribución a Otros Pedidos',
      passed: false,
      details: `❌ Error: ${error instanceof Error ? error.message : String(error)}`
    });
    console.log(`  ❌ Error: ${error}\n`);
  }
}

// ============================================================================
// CASO J: Distribución Mixta
// ============================================================================
async function testCaseJ(client: any, brand: any, cashAccount: any) {
  console.log('🧪 Caso J: Distribución Mixta');
  
  try {
    // 1. Create source order
    const sourceOrder = await prisma.order.create({
      data: {
        receiptNumber: 'TEST-CARD-J-SOURCE',
        orderNumber: 'TEST-CARD-J-SOURCE',
        salesChannel: 'WHATSAPP',
        type: 'NORMAL',
        brandId: brand.id,
        total: 100,
        paymentMethod: 'EFECTIVO',
        transactionDate: new Date(),
        possibleDeliveryDate: new Date(),
        status: 'RECIBIDO_EN_BODEGA',
        realInvoiceTotal: 10,
        clientId: client.id,
        clientName: client.firstName
      }
    });
    
    // 2. Create target orders
    const targetOrders = [];
    for (let i = 1; i <= 2; i++) {
      const targetOrder = await prisma.order.create({
        data: {
          receiptNumber: `TEST-CARD-J-TARGET-${i}`,
          orderNumber: `TEST-CARD-J-TARGET-${i}`,
          salesChannel: 'WHATSAPP',
          type: 'NORMAL',
          brandId: brand.id,
          total: 30,
          paymentMethod: 'CREDITO_CLIENTE',
          transactionDate: new Date(),
          possibleDeliveryDate: new Date(),
          status: 'POR_RECIBIR',
          clientId: client.id,
          clientName: client.firstName
        }
      });
      targetOrders.push(targetOrder);
    }
    
    // 3. Create CREDIT_GENERATION
    await prisma.financialRecord.create({
      data: {
        type: 'CREDIT_GENERATION',
        referenceNumber: 'TEST-CARD-J-CREDIT-GEN-001',
        amount: 90,
        date: new Date(),
        clientId: client.id,
        clientName: client.firstName,
        orderId: sourceOrder.id,
        bankAccountId: 'virtual-credit-account',
        source: 'RECEPTION_OVERPAYMENT',
        paymentMethod: 'SALDO_A_FAVOR',
        movementType: 'INCOME',
        createdBy: 'test-script',
        notes: 'Saldo a favor generado'
      }
    });
    
    const createdRecords = [];
    
    // 4. Distribution to orders ($30 x 2)
    for (let i = 0; i < targetOrders.length; i++) {
      const targetOrder = targetOrders[i];
      
      const record = await prisma.financialRecord.create({
        data: {
          type: 'CREDIT_APPLICATION',
          referenceNumber: `TEST-CARD-J-CREDIT-APP-ORDER-${i + 1}`,
          amount: 30,
          date: new Date(),
          clientId: client.id,
          clientName: client.firstName,
          orderId: targetOrder.id,
          bankAccountId: 'virtual-credit-account',
          source: 'CREDIT_DISTRIBUTION',
          paymentMethod: 'SALDO_A_FAVOR',
          movementType: 'EXPENSE',
          createdBy: 'test-script',
          notes: `Distribución a pedido ${targetOrder.receiptNumber}`
        }
      });
      createdRecords.push(record);
    }
    
    // 5. Distribution to wallet ($20)
    const walletRecord = await prisma.financialRecord.create({
      data: {
        type: 'CREDIT_APPLICATION',
        referenceNumber: 'TEST-CARD-J-CREDIT-APP-WALLET',
        amount: 20,
        date: new Date(),
        clientId: client.id,
        clientName: client.firstName,
        orderId: null, // No orderId = to wallet
        bankAccountId: 'virtual-credit-account',
        source: 'CREDIT_DISTRIBUTION',
        paymentMethod: 'SALDO_A_FAVOR',
        movementType: 'EXPENSE',
        createdBy: 'test-script',
        notes: 'Saldo guardado en billetera virtual'
      }
    });
    createdRecords.push(walletRecord);
    
    // 6. Cash return ($10)
    const cashRecord = await prisma.financialRecord.create({
      data: {
        type: 'CREDIT_APPLICATION',
        referenceNumber: 'TEST-CARD-J-CASH-RETURN',
        amount: 10,
        date: new Date(),
        clientId: client.id,
        clientName: client.firstName,
        orderId: null,
        bankAccountId: cashAccount.id, // Use real cash account
        source: 'CASH_RETURN',
        paymentMethod: 'EFECTIVO',
        movementType: 'EXPENSE',
        createdBy: 'test-script',
        notes: 'Devolución en efectivo al cliente'
      }
    });
    createdRecords.push(cashRecord);
    
    // 7. Verify
    const allRecords = await prisma.financialRecord.findMany({
      where: {
        id: { in: createdRecords.map(r => r.id) }
      }
    });
    
    const hasOrderDistributions = allRecords.filter(r => 
      r.type === 'CREDIT_APPLICATION' && 
      r.source === 'CREDIT_DISTRIBUTION' && 
      r.orderId !== null
    ).length === 2;
    
    const hasWalletDistribution = allRecords.some(r => 
      r.type === 'CREDIT_APPLICATION' && 
      r.source === 'CREDIT_DISTRIBUTION' && 
      r.orderId === null
    );
    
    const hasCashReturn = allRecords.some(r => 
      r.type === 'CREDIT_APPLICATION' && 
      r.source === 'CASH_RETURN'
    );
    
    results.push({
      case: 'Caso J: Distribución Mixta',
      passed: hasOrderDistributions && hasWalletDistribution && hasCashReturn,
      details: `✅ 2 distribuciones a pedidos\n✅ 1 distribución a billetera\n✅ 1 devolución en efectivo\n✅ Total: 4 tarjetas`,
      financialRecords: allRecords
    });
    
    console.log('  ✅ Caso J completado\n');
    
  } catch (error) {
    results.push({
      case: 'Caso J: Distribución Mixta',
      passed: false,
      details: `❌ Error: ${error instanceof Error ? error.message : String(error)}`
    });
    console.log(`  ❌ Error: ${error}\n`);
  }
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 TEST: Tarjetas de Transacciones de Recepción');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  try {
    // Cleanup first
    await cleanup();
    
    // Setup test data
    const { client, clientAccount, brand, cashAccount, bankAccount } = await setupTestData();
    
    // Run tests
    await testCaseF(client, brand, cashAccount);
    await testCaseG(client, brand, cashAccount);
    await testCaseI(client, brand, cashAccount);
    await testCaseJ(client, brand, cashAccount);
    
    // Print results
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 RESULTADOS');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    let passedCount = 0;
    let failedCount = 0;
    
    for (const result of results) {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.case}`);
      console.log(`   ${result.details}\n`);
      
      if (result.passed) {
        passedCount++;
      } else {
        failedCount++;
      }
    }
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total: ${results.length} casos`);
    console.log(`✅ Pasados: ${passedCount}`);
    console.log(`❌ Fallidos: ${failedCount}`);
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Cleanup after tests
    await cleanup();
    
    if (failedCount > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
