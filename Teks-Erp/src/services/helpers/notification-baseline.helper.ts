// =============================================================================
// BİLDİRİM KOŞUL SU DAMGASI — ilk açılış tabanı (patron kararı 2026-10-26, ölçüm: 807 geciken sipariş → 125.766 satır)
// =============================================================================
// Bayrak açıldıktan sonra her KOSUL türünün İLK turu "taban" turudur: o an doğru olan konular koşul tablosuna
// SESSİZCE yazılır (bildirim ÜRETMEZ); yalnız sonraki turlarda yeni açılan/kapanan konular bildirim üretir.
// Damga tür başına `system_settings` satırıdır (`bildirim.kosulTabani.<tür>` = taban anı ISO); değer metin
// değilse taban YOK sayılır. Bayrak kapanınca (ya da kapalıdan açılınca) bütün damgalar düşer → yeniden taban.
// =============================================================================
import type prisma from "../../lib/prisma";

export const NOTIFICATION_BASELINE_KEY_PREFIX = "bildirim.kosulTabani.";

type SettingClient = Pick<typeof prisma, "systemSetting">;

export function notificationBaselineKey(kind: string): string {
  return `${NOTIFICATION_BASELINE_KEY_PREFIX}${kind}`;
}

/** Bu tür için bayrak açıldığından beri taban turu yapıldı mı? */
export async function hasNotificationBaseline(client: SettingClient, kind: string): Promise<boolean> {
  const row = await client.systemSetting.findUnique({ where: { key: notificationBaselineKey(kind) }, select: { value: true } });
  return typeof row?.value === "string";
}

/** Taban turunun damgası (koşul turu tx'i içinde, kilit altında). Sistem damgası; audit'siz (bakım su damgası deseni). */
export async function markNotificationBaseline(client: SettingClient, kind: string, at: Date = new Date()): Promise<void> {
  const key = notificationBaselineKey(kind);
  const value = at.toISOString();
  await client.systemSetting.upsert({
    where: { key },
    create: { key, value, description: "Bildirim koşul su damgası: bu andaki birikmiş koşullar bildirimsiz taban sayıldı" },
    update: { value },
  });
}

/** Bütün damgaları düşür (satır silinmez, değer `false` olur) → bayrak yeniden açılınca her tür yeniden taban alır. */
export async function resetNotificationBaselines(client: SettingClient): Promise<number> {
  const r = await client.systemSetting.updateMany({
    where: { key: { startsWith: NOTIFICATION_BASELINE_KEY_PREFIX } },
    data: { value: false },
  });
  return r.count;
}
