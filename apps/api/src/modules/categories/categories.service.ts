import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { prismaCode, uniqueViolationOn } from '../../utils/prismaErrors';

const withCount = { _count: { select: { products: true } } } as const;

function toDto(category: { id: string; name: string; _count: { products: number } }) {
  return { id: category.id, name: category.name, productCount: category._count.products };
}

async function assertNameFree(storeId: string, name: string, exceptId?: string) {
  const clash = await prisma.category.findFirst({
    where: {
      storeId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new AppError(409, 'CATEGORY_EXISTS', 'A category with this name already exists');
}

export async function listCategories(storeId: string) {
  const rows = await prisma.category.findMany({
    where: { storeId },
    include: withCount,
    orderBy: { name: 'asc' },
  });
  return rows.map(toDto);
}

export async function createCategory(storeId: string, name: string) {
  await assertNameFree(storeId, name);
  try {
    return toDto(await prisma.category.create({ data: { storeId, name }, include: withCount }));
  } catch (err) {
    if (uniqueViolationOn(err, 'name'))
      throw new AppError(409, 'CATEGORY_EXISTS', 'A category with this name already exists');
    throw err;
  }
}

export async function renameCategory(storeId: string, id: string, name: string) {
  await assertNameFree(storeId, name, id);
  try {
    return toDto(
      await prisma.category.update({ where: { id, storeId }, data: { name }, include: withCount }),
    );
  } catch (err) {
    if (prismaCode(err) === 'P2025') throw new AppError(404, 'NOT_FOUND', 'Category not found');
    if (uniqueViolationOn(err, 'name'))
      throw new AppError(409, 'CATEGORY_EXISTS', 'A category with this name already exists');
    throw err;
  }
}

export async function deleteCategory(storeId: string, id: string) {
  if (await prisma.product.count({ where: { storeId, categoryId: id } })) {
    throw new AppError(
      409,
      'CATEGORY_IN_USE',
      'This category still has products. Move or archive them first.',
    );
  }
  try {
    await prisma.category.delete({ where: { id, storeId } });
  } catch (err) {
    if (prismaCode(err) === 'P2025') throw new AppError(404, 'NOT_FOUND', 'Category not found');
    if (prismaCode(err) === 'P2003')
      throw new AppError(409, 'CATEGORY_IN_USE', 'This category still has products.');
    throw err;
  }
}
