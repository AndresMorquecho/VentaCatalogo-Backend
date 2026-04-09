import { PrismaClient } from '@prisma/client';
import fs from 'fs';
const prisma = new PrismaClient();

async function main() {
    const p = await prisma.orderPayment.findMany({
        where: { orderId: { in: ['44bdd5c6-76c7-4147-a724-0b71f786ee21', 'bdba5186-1de4-4332-a92a-bacad7420a8d', '6d58af1f-2486-4638-bc4b-fce37dd20060'] } }
    });
    fs.writeFileSync('all_payments.json', JSON.stringify(p, null, 2), 'utf8');
}
main().catch(console.error).finally(() => prisma.$disconnect());
