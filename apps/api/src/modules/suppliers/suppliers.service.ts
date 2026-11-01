import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { prismaCode, uniqueViolationOn } from '../../utils/prismaErrors';
import type { SupplierInput, SupplierUpdateInput } from './suppliers.schemas';

export async function listSuppliers(storeId: string, includeArchived = false) {
  const rows = await prisma.supplier.findMany({
    where: { storeId, ...(includeArchived ? {} : { isActive: true }) },
    orderBy: { name: 'asc' },
  });
  return rows;
}

export async function createSupplier(storeId: string, input: SupplierInput) {
  try {
    return await prisma.supplier.create({ data: { storeId, ...input } });
  } catch (err) {
    if (uniqueViolationOn(err, 'name'))
      throw new AppError(409, 'SUPPLIER_EXISTS', 'A supplier with this name already exists');
    throw err;
  }
}

export async function updateSupplier(storeId: string, id: string, input: SupplierUpdateInput) {
  try {
    return await prisma.supplier.update({ where: { id, storeId }, data: input });
  } catch (err) {
    if (prismaCode(err) === 'P2025') throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
    if (uniqueViolationOn(err, 'name'))
      throw new AppError(409, 'SUPPLIER_EXISTS', 'A supplier with this name already exists');
    throw err;
  }
}

export async function archiveSupplier(storeId: string, id: string) {
  return updateSupplier(storeId, id, { isActive: false });
}
