// =============================================================================
// REFAKAT KARTI "BAYAT" İŞARETİ — tek yazma noktası
// =============================================================================
// Kart, malla birlikte gezen FİZİKSEL bir kâğıttır. Sistemdeki veri değiştiğinde
// eldeki kâğıt sessizce yanlışlanır; bu helper o anı işaretler ve operatör
// "yeniden bas" uyarısını görür. Emsal: `Roll.labelDirty` / `Sack.labelDirty`.
//
// NEDEN AYRI DOSYA: `traveler-card.service` → `batch.service` (K18_DEAD_STATUSES)
// yönünde bir import zaten var. İşaretleyiciyi servise koyup `batch.service`'ten
// çağırmak DÖNGÜ yaratırdı. Helper hiçbir servise bağlı değil → herkes çağırabilir.
//
// ⚠️ KART İLE ROL ETİKETİ AYNI KURALI İZLEMEZ. K18 "ilk parti ataması bayraklanmaz"
// der (top etiketi henüz parti numarasıyla basılmamıştır). Kartta TERSİ geçerlidir:
// kart iş emri AÇILIŞINDA basılabilir — o an ne top ne parti vardır — dolayısıyla
// ilk parti doğuşu kâğıdı yanlışlayan ASIL olaydır. K18 koşulunu buraya kopyalama.
// =============================================================================

import { Prisma, TravelerCardStatus } from "@prisma/client";

/**
 * İş emrinin AKTİF refakat kartını "bayat" işaretler.
 *
 * Yön kuralı: **fazla işaretlemek güvenli, eksik işaretlemek hata.** Fazladan bir
 * rozet operatöre gereksiz bir baskı yaptırır; eksik rozet ise sahaya yanlış parti
 * numarası taşıyan kâğıt gönderir. Şüphede işaretle.
 *
 * `contentDirty: false` koşulu bilinçli (labelDirty emsali): zaten işaretli kartta
 * gereksiz UPDATE yazmaz — yüksek trafikli parti/sevk yollarından çağrılıyor.
 *
 * VOIDED/iptal kartlar kapsam dışı: basılacak bir kâğıt yok.
 *
 * @returns işaretlenen kart sayısı (0 = kart yok ya da zaten bayat)
 */
export async function markTravelerCardDirtyTx(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<number> {
  const res = await tx.travelerCard.updateMany({
    where: { workOrderId, status: TravelerCardStatus.ACTIVE, contentDirty: false },
    data: { contentDirty: true },
  });
  return res.count;
}

/**
 * Aynı işaret, ÇOK iş emri için (parti birleştirme gibi WO sınırını aşabilen
 * işlemlerde). Boş dizi güvenli — sorgu koşmaz.
 */
export async function markTravelerCardsDirtyTx(
  tx: Prisma.TransactionClient,
  workOrderIds: string[],
): Promise<number> {
  const ids = [...new Set(workOrderIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const res = await tx.travelerCard.updateMany({
    where: { workOrderId: { in: ids }, status: TravelerCardStatus.ACTIVE, contentDirty: false },
    data: { contentDirty: true },
  });
  return res.count;
}
