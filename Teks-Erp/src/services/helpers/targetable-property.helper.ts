// =============================================================================
// TeksERP - "Bu özellik HEDEF olabilir mi?" — sunucu tarafı tek yüklem (2026-08-11)
// =============================================================================
// KURAL: SEÇİM (CHOICE) tipli özellik hedef/planlama listelerine GİREMEZ.
// "Kat" ya da "Gramaj" bir hedef değil bir SORUDUR — cevabını (2-KAT? 50GR?)
// istasyonda operatör verir. Hedef listesine girerse iki şey bozulur:
//   1. Anlamsız hedef: "bu iş emrinin hedefi GRAMAJ" (hangi gramaj?)
//   2. Değersiz kopya: fason kabul / hedef-replace yolları o özelliği doğan
//      toplara valueId=NULL ile işler — "özellik var, değeri belli değil".
//
// Bu kural istemcide zaten vardı (`isTargetableProperty`, Electron 5 yüzey +
// mobil) ama SUNUCUDA KARŞILIĞI YOKTU — API'den (ya da süzgüsü eksik bir
// istemciden) "KAT" hedef özellik olarak yazılabiliyordu ve rota-kapsama
// kontrolü TAMBUR_1×KAT satırı sayesinde onu "uygulanabilir" sayıyordu
// (2026-08-11 denetimi, bulgu Q2). İstemci süzgüsü UI konforudur; sözleşmeyi
// sunucu korur.
//
// İKİ FONKSİYON, İKİ FARKLI ÇAĞIRAN SINIFI — karıştırma:
//   • `assertTargetablePropertyIds` → 400. Kullanıcının AKTİF SEÇİM yaptığı
//     uçlar için (WO hedefi, sipariş satırı, rota adımı, fason kabul override,
//     KK1 girişi, ürün izinli listesi): oralarda CHOICE id'nin gelmesi gerçek
//     bir hatadır ve kullanıcıya adıyla söylenmelidir.
//   • `partitionTargetableIds` → sessiz AYIRMA. İstemcinin mevcut listeyi
//     OLDUĞU GİBİ geri yolladığı (echo) uçlar için (Düzelt/relabel): orada 400
//     dönmek, gramajlı topun HİÇBİR alanını düzeltilemez yapardı — istemci o
//     id'yi kendisi seçmedi, bağlamdan devraldı.
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

type Reader = Pick<typeof prisma, "fabricProperty">;

/** id → {name, valueType} haritası. Var olmayan id'ler haritada OLMAZ. */
async function loadValueTypes(
  ids: string[],
  client: Reader,
): Promise<Map<string, { name: string; valueType: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await client.fabricProperty.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, valueType: true },
  });
  return new Map(rows.map((r) => [r.id, { name: r.name, valueType: r.valueType }]));
}

/**
 * Hedef listesinde CHOICE varsa özellik ADIYLA 400.
 * `context` hata cümlesine girer ("hedef özellik", "sipariş satırı özelliği"…).
 *
 * ⚠️ Var-olmayan/pasif id kontrolü BURADA YAPILMAZ — çağıranların mevcut
 * doğrulamaları (isActive + allowed-list) aynen kalır; bu yüklem yalnız tip
 * sorusunu yanıtlar. İkisini birleştirmek, her çağıranın kendi hata mesajı
 * sözleşmesini bozardı.
 */
export async function assertTargetablePropertyIds(
  ids: string[],
  context: string,
  client: Reader = prisma,
): Promise<void> {
  const types = await loadValueTypes([...new Set(ids)], client);
  const bad = [...types.values()].filter((t) => t.valueType === "CHOICE");
  if (bad.length > 0) {
    throw AppError.badRequest(
      `'${bad.map((b) => b.name).join("', '")}' SEÇİM tipli özelliktir — ${context} olarak seçilemez. ` +
        `Değerini istasyonda operatör belirler (Kat → Tambur, Gramaj → Kurşun gibi).`,
    );
  }
}

/**
 * Echo uçları için sessiz ayırma: `flagIds` (yönetilebilir küme) + `choiceIds`
 * (dokunulmayacak küme). Çağıran yalnız `flagIds` üzerinde replace yapar ve
 * audit'e `choiceIds`i "dokunulmadı" olarak yazar — sessiz süzme audit'te
 * görünmez olmamalı.
 */
export async function partitionTargetableIds(
  ids: string[],
  client: Reader = prisma,
): Promise<{ flagIds: string[]; choiceIds: string[] }> {
  const unique = [...new Set(ids)];
  const types = await loadValueTypes(unique, client);
  const flagIds: string[] = [];
  const choiceIds: string[] = [];
  for (const id of unique) {
    // Haritada olmayan id'yi FLAG say — varlık/aktiflik kontrolü çağıranın işi
    // ve oradaki 400 mesajı ("bulunamadı veya pasif") daha doğru.
    if (types.get(id)?.valueType === "CHOICE") choiceIds.push(id);
    else flagIds.push(id);
  }
  return { flagIds, choiceIds };
}
