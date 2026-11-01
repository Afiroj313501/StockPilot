import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { prismaCode, uniqueViolationOn } from '../../utils/prismaErrors';
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from './suppliers.schemas';

const withCount = { _count: { select: { purchaseOrders: true } } } as const;
type SupplierRow = Prisma.SupplierGetPayload<{ include: typeof withCount }>;

function toDto(s: SupplierRow) {
  return {
    id: s.id,
    name: s.name,
    contactName: s.contactName,
    email: s.email,
    phone: s.phone,
    address: s.address,
    notes: s.notes,
    leadTimeDays: s.leadTimeDays,
    isActive: s.isActive,
    orderCount: s._count.purchaseOrders,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const exists = () =>
  new AppError(409, 'SUPPLIER_EXISTS', 'A supplier with this name already exists');

function translate(err: unknown): unknown {
  if (uniqueViolationOn(err, 'name')) return exists();
  if (prismaCode(err) === 'P2025') return new AppError(404, 'NOT_FOUND', 'Supplier not found');
  return err;
}

async function assertNameFree(storeId: string, name: string, exceptId?: string) {
  const clash = await prisma.supplier.findFirst({
    where: {
      storeId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw exists();
}

export async function listSuppliers(storeId: string, q: ListSuppliersQuery) {
  const where: Prisma.SupplierWhereInput = { storeId };
  if (q.status !== 'all') where.isActive = q.status === 'active';
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: 'insensitive' } },
      { contactName: { contains: q.search, mode: 'insensitive' } },
      { email: { contains: q.search, mode: 'insensitive' } },
    ];
  }

  const [total, rows] = await prisma.$transaction([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      include: withCount,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  return {
    items: rows.map(toDto),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
  };
}

export async function getSupplier(storeId: string, id: string) {
  const row = await prisma.supplier.findFirst({ where: { id, storeId }, include: withCount });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
  return toDto(row);
}

export async function createSupplier(storeId: string, input: CreateSupplierInput) {
  await assertNameFree(storeId, input.name);
  try {
    const row = await prisma.supplier.create({
      data: {
        storeId,
        name: input.name,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        leadTimeDays: input.leadTimeDays ?? null,
      },
      include: withCount,
    });
    return toDto(row);
  } catch (err) {
    throw translate(err);
  }
}

export async function updateSupplier(storeId: string, id: string, input: UpdateSupplierInput) {
  if (input.name !== undefined) await assertNameFree(storeId, input.name, id);
  try {
    const row = await prisma.supplier.update({
      where: { id, storeId },
      data: input,
      include: withCount,
    });
    return toDto(row);
  } catch (err) {
    throw translate(err);
  }
}
