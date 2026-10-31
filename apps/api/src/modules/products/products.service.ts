import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { formatMoney, toDecimal } from '../../utils/money';
import { prismaCode, uniqueViolationOn } from '../../utils/prismaErrors';
import { hasRole } from '../auth/rbac';
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from './products.schemas';

const productInclude = {
  category: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;
type ProductWithCategory = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function toDto(product: ProductWithCategory, role: Role) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    description: product.description,
    unit: product.unit,
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    costPrice: hasRole(role, 'MANAGER') ? formatMoney(product.costPrice) : null,
    sellingPrice: formatMoney(product.sellingPrice),
    stockQuantity: product.stockQuantity,
    reorderThreshold: product.reorderThreshold,
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function translate(err: unknown): unknown {
  if (uniqueViolationOn(err, 'sku'))
    return new AppError(409, 'SKU_TAKEN', 'This SKU is already used by another product');
  if (uniqueViolationOn(err, 'barcode'))
    return new AppError(409, 'BARCODE_TAKEN', 'This barcode is already used by another product');
  if (prismaCode(err) === 'P2025') return new AppError(404, 'NOT_FOUND', 'Product not found');
  return err;
}

async function assertCategoryInStore(storeId: string, categoryId: string) {
  const found = await prisma.category.findFirst({
    where: { id: categoryId, storeId },
    select: { id: true },
  });
  if (!found) throw new AppError(400, 'INVALID_CATEGORY', 'Category not found in this store');
}

export async function listProducts(storeId: string, role: Role, query: ListProductsQuery) {
  const where: Prisma.ProductWhereInput = { storeId };
  if (query.status !== 'all') where.isActive = query.status === 'active';
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.search)
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { sku: { contains: query.search, mode: 'insensitive' } },
      { barcode: { contains: query.search } },
    ];
  const orderBy: Prisma.ProductOrderByWithRelationInput = { [query.sort]: query.order };
  const [total, rows] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: [orderBy, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map((row) => toDto(row, role)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export async function getProduct(storeId: string, role: Role, id: string) {
  const row = await prisma.product.findFirst({ where: { id, storeId }, include: productInclude });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Product not found');
  return toDto(row, role);
}

export async function createProduct(storeId: string, role: Role, input: CreateProductInput) {
  if (input.categoryId) await assertCategoryInStore(storeId, input.categoryId);
  try {
    const row = await prisma.product.create({
      data: {
        storeId,
        name: input.name,
        sku: input.sku,
        barcode: input.barcode ?? null,
        description: input.description ?? null,
        unit: input.unit ?? null,
        categoryId: input.categoryId ?? null,
        costPrice: toDecimal(input.costPrice),
        sellingPrice: toDecimal(input.sellingPrice),
        reorderThreshold: input.reorderThreshold ?? null,
      },
      include: productInclude,
    });
    return toDto(row, role);
  } catch (err) {
    throw translate(err);
  }
}

export async function updateProduct(
  storeId: string,
  role: Role,
  id: string,
  input: UpdateProductInput,
) {
  if (input.categoryId) await assertCategoryInStore(storeId, input.categoryId);
  const { costPrice, sellingPrice, ...rest } = input;
  const data: Prisma.ProductUncheckedUpdateInput = { ...rest };
  if (costPrice !== undefined) data.costPrice = toDecimal(costPrice);
  if (sellingPrice !== undefined) data.sellingPrice = toDecimal(sellingPrice);
  try {
    const row = await prisma.product.update({
      where: { id, storeId },
      data,
      include: productInclude,
    });
    return toDto(row, role);
  } catch (err) {
    throw translate(err);
  }
}

export async function deleteProduct(storeId: string, id: string) {
  try {
    await prisma.product.delete({ where: { id, storeId } });
  } catch (err) {
    if (prismaCode(err) === 'P2003')
      throw new AppError(
        409,
        'PRODUCT_IN_USE',
        'This product has history and cannot be deleted. Archive it instead.',
      );
    throw translate(err);
  }
}
