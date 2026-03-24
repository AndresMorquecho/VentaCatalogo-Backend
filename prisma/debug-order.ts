
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkData() {
    try {
        const orderId = '650205cb-8a43-4f6c-b2e1-e5f342dd49b1';
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { client: { include: { clientAccount: { include: { credits: true } } } } }
        });

        if (!order) {
            console.log('Order not found');
            return;
        }

        console.log('Order found:', {
            id: order.id,
            clientId: order.clientId,
            clientName: order.clientName,
            status: order.status
        });

        const clientAccount = order.client.clientAccount;
        if (!clientAccount) {
            console.log('Client account not found');
            return;
        }

        console.log('Client account found:', {
            id: clientAccount.id,
            totalCreditAvailable: clientAccount.totalCreditAvailable,
            creditsCount: clientAccount.credits.length
        });

        const availableCredits = clientAccount.credits.filter(c => c.status === 'AVAILABLE');
        console.log('Available credits:', availableCredits.map(c => ({
            id: c.id,
            amount: c.amount,
            remainingAmount: c.remainingAmount,
            status: c.status
        })));
        
        const sum = availableCredits.reduce((acc, c) => acc + Number(c.remainingAmount), 0);
        console.log('Total available credit sum:', sum);

    } catch (error) {
        console.error('Error checking data:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkData();
