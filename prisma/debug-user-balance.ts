import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const userId = process.argv[2]; // JARM's ID or username
    console.log('Searching records for:', userId);
    
    // First find the user to get the username
    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { id: userId },
                { username: { contains: userId, mode: 'insensitive' } }
            ]
        }
    });
    
    if (!user) {
        console.log('User not found');
        return;
    }
    
    console.log('Found user:', user.username, '(', user.id, ')');
    
    const records = await prisma.financialRecord.findMany({
        where: { createdBy: user.username },
        select: { amount: true, movementType: true, date: true, notes: true }
    });
    
    console.log('Total records:', records.length);
    let total = 0;
    records.forEach(r => {
        const amt = Number(r.amount);
        if (r.movementType === 'INCOME') total += amt;
        else total -= amt;
    });
    
    console.log('Historical Total for', user.username, ':', total);
    
    const today = new Date();
    today.setHours(0,0,0,0);
    const todayRecords = records.filter(r => new Date(r.date) >= today);
    console.log('Today records:', todayRecords.length);
    let todayTotal = 0;
    todayRecords.forEach(r => {
        const amt = Number(r.amount);
        if (r.movementType === 'INCOME') todayTotal += amt;
        else todayTotal -= amt;
    });
    console.log('Today Total for', user.username, ':', todayTotal);
}
main().finally(() => prisma.$disconnect());
