import { prisma } from '../db/prisma';

export async function resetDb(): Promise<void> {
  // Safety net: never wipe anything that is not the test database.
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('Refusing to reset a database whose name does not end in _test');
  }
  await prisma.session.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.reorderReview.deleteMany();
  await prisma.saleReturnItem.deleteMany();
  await prisma.saleReturn.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.purchaseReceiptItem.deleteMany();
  await prisma.purchaseReceipt.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.storeMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.storeSetting.deleteMany();
  await prisma.store.deleteMany();
}
