import { Prisma } from '@prisma/client';

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export function formatMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}
