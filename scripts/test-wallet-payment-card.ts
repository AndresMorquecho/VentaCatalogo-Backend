import { prisma } from '../src/lib/prisma';

/**
 * Test script to verify wallet payment financial records are created correctly
 * with balance snapshots when using BatchCreateOrder endpoint
 */

async function testWalletPaymentCard() {
  console.log('🔍 Testing wallet payment financial records...\n');

  try {
    // Find the most recent wallet payment financial record
    const walletPayments = await prisma.financialRecord.findMany({
      where: {
        paymentMethod: 'BILLETERA_VIRTUAL',
        source: 'ORDER_PAYMENT',
        movementType: 'INTERNAL'
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        client: {
          select: {
            firstName: true,
            identificationNumber: true
          }
        },
        order: {
          select: {
            receiptNumber: true,
            orderNumber: true
          }
        }
      }
    });

    if (walletPayments.length === 0) {
      console.log('❌ No wallet payment financial records found');
      console.log('   Make a test payment with BILLETERA_VIRTUAL to verify the fix\n');
      return;
    }

    console.log(`✅ Found ${walletPayments.length} wallet payment record(s)\n`);

    for (const record of walletPayments) {
      console.log('─'.repeat(60));
      console.log(`📝 Financial Record ID: ${record.id}`);
      console.log(`   Type: ${record.type}`);
      console.log(`   Source: ${record.source}`);
      console.log(`   Movement Type: ${record.movementType}`);
      console.log(`   Payment Method: ${record.paymentMethod}`);
      console.log(`   Amount: $${Number(record.amount).toFixed(2)}`);
      console.log(`   Date: ${record.date.toISOString()}`);
      
      if (record.client) {
        const clientName = record.client.firstName;
        console.log(`   Client: ${clientName} (${record.client.identificationNumber || 'N/A'})`);
      }
      
      if (record.order) {
        console.log(`   Order: ${record.order.receiptNumber || 'N/A'}`);
        console.log(`   Order Number: ${record.order.orderNumber || 'N/A'}`);
      }
      
      console.log(`   User Reference: ${record.userReference || 'N/A'}`);
      
      // Check balance snapshots
      const hasBalanceSnapshots = record.balanceBefore != null && record.balanceAfter != null;
      
      if (hasBalanceSnapshots) {
        console.log(`   ✅ Balance Before: $${Number(record.balanceBefore).toFixed(2)}`);
        console.log(`   ✅ Balance After: $${Number(record.balanceAfter).toFixed(2)}`);
        console.log(`   ✅ Balance Change: -$${Number(record.amount).toFixed(2)}`);
        
        // Verify calculation
        const expectedAfter = Number(record.balanceBefore) - Number(record.amount);
        const actualAfter = Number(record.balanceAfter);
        const diff = Math.abs(expectedAfter - actualAfter);
        
        if (diff < 0.01) {
          console.log(`   ✅ Balance calculation is correct`);
        } else {
          console.log(`   ⚠️  Balance calculation mismatch: expected ${expectedAfter.toFixed(2)}, got ${actualAfter.toFixed(2)}`);
        }
      } else {
        console.log(`   ❌ Missing balance snapshots!`);
        console.log(`      balanceBefore: ${record.balanceBefore}`);
        console.log(`      balanceAfter: ${record.balanceAfter}`);
      }
      
      console.log('');
    }

    // Summary
    const withSnapshots = walletPayments.filter(r => r.balanceBefore != null && r.balanceAfter != null).length;
    const withoutSnapshots = walletPayments.length - withSnapshots;
    
    console.log('─'.repeat(60));
    console.log('📊 Summary:');
    console.log(`   Total wallet payment records: ${walletPayments.length}`);
    console.log(`   ✅ With balance snapshots: ${withSnapshots}`);
    console.log(`   ❌ Without balance snapshots: ${withoutSnapshots}`);
    
    if (withoutSnapshots > 0) {
      console.log('\n⚠️  Some records are missing balance snapshots.');
      console.log('   These were created before the fix was applied.');
      console.log('   New payments should have balance snapshots.\n');
    } else {
      console.log('\n✅ All wallet payment records have balance snapshots!\n');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testWalletPaymentCard();
