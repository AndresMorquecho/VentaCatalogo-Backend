const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const records = await prisma.financialRecord.findMany({
    where: {
      source: {
        in: ['RECEPTION_OVERPAYMENT', 'CREDIT_DISTRIBUTION', 'CASH_RETURN']
      },
      OR: [
        { notes: { contains: 'Saldo a favor generado |' } },
        { notes: { contains: 'Distribución de saldo restante |' } },
        { notes: { contains: 'Ahorro en billetera |' } },
        { notes: { contains: 'Pago con saldo a favor |' } },
        { notes: { contains: 'Saldo guardado en billetera virtual |' } },
        { referenceNumber: { startsWith: 'CREDIT-GEN-' } },
        { referenceNumber: { startsWith: 'CREDIT-APP-' } },
        { referenceNumber: { startsWith: 'CREDIT-OUT-' } },
        { referenceNumber: { startsWith: 'CREDIT-IN-' } },
        { referenceNumber: { startsWith: 'WALLET-REF-' } },
        { referenceNumber: { startsWith: 'CASH-RETURN-' } }
      ]
    }
  })

  console.log(`Found ${records.length} records to delete`)
  
  if (records.length > 0) {
    const deleted = await prisma.financialRecord.deleteMany({
      where: {
        id: { in: records.map(r => r.id) }
      }
    })
    console.log(`Deleted ${deleted.count} financial records.`)
  }

  const credits = await prisma.clientCredit.findMany({
    where: {
      originTransactionId: {
        startsWith: 'RECEPTION'
      }
    }
  })

  console.log(`Found ${credits.length} credits to delete`)
  
  if (credits.length > 0) {
    const deletedCredits = await prisma.clientCredit.deleteMany({
      where: {
        id: { in: credits.map(c => c.id) }
      }
    })
    console.log(`Deleted ${deletedCredits.count} client credits.`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
