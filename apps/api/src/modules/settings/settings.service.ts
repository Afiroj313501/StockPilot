import type { Prisma, StoreSetting } from '@prisma/client';
import { prisma } from '../../db/prisma';
import type { UpdateSettingsInput } from './settings.schemas';

function toDto(storeName: string, setting: StoreSetting) {
  return {
    storeName,
    businessCategory: setting.businessCategory,
    address: setting.address,
    phone: setting.phone,
    contactEmail: setting.contactEmail,
    currency: setting.currency,
    timeZone: setting.timeZone,
    taxName: setting.taxName,
    taxRatePercent: setting.taxRatePercent.toFixed(2),
    taxInclusive: setting.taxInclusive,
    receiptFooter: setting.receiptFooter,
    allowNegativeStock: setting.allowNegativeStock,
    defaultLowStockThreshold: setting.defaultLowStockThreshold,
    defaultLeadTimeDays: setting.defaultLeadTimeDays,
    onboardingCompletedAt: setting.onboardingCompletedAt?.toISOString() ?? null,
    updatedAt: setting.updatedAt.toISOString(),
  };
}

export async function getSettings(storeId: string) {
  const [store, setting] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: storeId } }),
    prisma.storeSetting.upsert({ where: { storeId }, create: { storeId }, update: {} }),
  ]);
  return toDto(store.name, setting);
}

export async function updateSettings(storeId: string, input: UpdateSettingsInput) {
  const { storeName, completeOnboarding, ...fields } = input;

  await prisma.$transaction(async (tx) => {
    if (storeName !== undefined) {
      await tx.store.update({ where: { id: storeId }, data: { name: storeName } });
    }
    const current = await tx.storeSetting.upsert({
      where: { storeId },
      create: { storeId },
      update: {},
    });
    const data: Prisma.StoreSettingUncheckedUpdateInput = { ...fields };
    if (completeOnboarding && !current.onboardingCompletedAt) {
      data.onboardingCompletedAt = new Date();
    }
    await tx.storeSetting.update({ where: { storeId }, data });
  });

  return getSettings(storeId);
}
