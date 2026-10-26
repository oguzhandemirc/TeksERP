// Bildirim koşul su damgası — bekçi kurgusu. Koşul türünü sınayan bekçi "ilk tur ACILDI" bekler; gerçek
// tarayıcıda bayrak açıldıktan sonraki İLK tur sessiz tabandır. Bekçi damgayı önceden basar, sonunda geri koyar.
import prisma from "../../src/lib/prisma";
import { markNotificationBaseline, notificationBaselineKey } from "../../src/services/helpers/notification-baseline.helper";
import { hedefDbEngeli } from "./hedef-db-kapisi";

/** Türlerin damgasını bas; dönen fonksiyon önceki değerleri geri koyar (yoksa satırı siler — test DB). */
export async function kosulTabaniHazir(kinds: readonly string[]): Promise<() => Promise<void>> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`koşul tabanı kurulmadı — ${engel}`);
  const keys = kinds.map(notificationBaselineKey);
  const ilk = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  for (const k of kinds) await markNotificationBaseline(prisma, k);
  return async () => {
    for (const key of keys) {
      const v = ilk.find((r) => r.key === key);
      if (v) await prisma.systemSetting.update({ where: { key }, data: { value: v.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  };
}
