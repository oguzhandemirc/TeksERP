// =============================================================================
// Fason çekisinin "YAPILACAK İŞLEMLER" satırı — ADIM BAZLI hedef özellik çözümü
// =============================================================================
// SAHA İSTEĞİ (2026-08-15): "iş emrinde renk olmayabilir ama mutlaka boyahanede
// yapılacak bir üretim özelliği vardır. o özellikler de 'YAPILACAK İŞLEMLER :
// APRE' örnekteki gibi net şekilde yazalım."
//
// ⚠️ ETİKET, KAYNAĞI ZORUNLU KILAR. Çeki bugüne kadar `WorkOrder.targetProperties`
// listesini "İSTENEN ÖZELLİKLER" başlığıyla basıyordu — yani iş emrinin TÜM
// hedeflerini, adıma göre süzmeden. Bu liste "YAPILACAK İŞLEMLER" diye
// etiketlenirse belge BU SEVKİN gittiği firmaya, o firmanın YAPMAYACAĞI bir işi
// talimat olarak vermiş olur. Şekli olan gerçek kayıt var (IE2207260001 hedefleri:
// YUMUŞAK TUŞE -1 + AÇMAZLIK + JET BOYA PİŞİRME + **KURŞUNLU**; KURŞUNLU yalnız
// "Kurşun + KK2" istasyonunun yeteneğidir) — süzgeçsiz basılsaydı boyahaneye
// "KURŞUNLU yap" talimatı giderdi. Aynı sınıf tuzak renk tarafında da var
// ("BOYANACAK RENK: EKRU"), orada çözüm ayrı payload alanıdır (`commands.color`).
//
// KAYNAK SEÇİMİ (dört aday, üçü elendi):
//   • `WorkOrderTargetProperty`  → TEMEL KÜME (üretimin gerçek hedefi), ama tek
//     başına adım bilgisi taşımaz.
//   • `StationProperty`          → SÜZGEÇ ("bu istasyon bunu yapabilir"), tek
//     başına basılırsa firmanın yetenek kataloğu damgalanır, talimat olmaz.
//   • `RouteStepProperty`        → şablon ÖNERİSİDİR, gerçekleşen sevkin değil
//     (ayrıca `SubcontractorDispatch` `WorkOrderStep`'e bağlıdır, `RouteStep`'e
//     değil; ölçüm: canlıda 0 satır).
//   • `SubcontractorCategory.appliesProperty` → iki değerli bayrak, liste taşımaz.
// ⇒ Doğru cevap KESİŞİMDİR ve KAYIPSIZDIR: `workorder.service.ts` iş emri
//   açılışında HER hedef özellik için rotada onu uygulayabilen bir istasyon
//   olmasını zaten ZORUNLU kılıyor → hedefler adımlara kayıpsız bölüşür.
//
// ⚠️ FAIL-CLOSED: kesişim boşsa BOŞ dizi döner. "Hiçbiri eşleşmedi → hepsini bas"
// dalı, tam da önlenmek istenen yanlış talimatı üretirdi.
//
// ⚠️ TEK KAYNAK: gerçek sevk (`buildFasonDispatchDoc`) ve TASLAK çeki
// (`previewDownstreamFasonCeki`) ikisi de buradan beslenir. Kopyalanırsa taslakta
// görülen talimat ile basılan talimat sessizce ayrışır.
// =============================================================================

import type { PrintedDocDb } from "../printed-document.service";

/**
 * Çekiye basılacak tek bir iş kalemi.
 *
 * ⚠️ ŞEKİL DEĞER-HAZIRDIR ama bugün `value` HER ZAMAN undefined'dır ve bu bir
 * ihmal değil ŞEMA GERÇEĞİDİR: `WorkOrderTargetProperty`'de değer kolonu YOKTUR
 * ve `assertTargetablePropertyIds` SEÇİM (CHOICE) tipli — yani değer taşıyan —
 * özelliğin iş emri hedefi olmasını 400 ile reddeder ("değerini istasyonda
 * operatör belirler"). Değer `RollProperty.valueId`'de, yani İŞ BİTTİKTEN SONRA
 * doğar; çeki ise iş yapılmadan ÖNCE dışarı giden bir TALİMATtır. Yani yutulan
 * bir değer yok — kaynakta hiç doğmuyor.
 * Değer bir gün hedef seviyesine taşınırsa kaynağı `FabricPropertyValue.name`
 * (GÖSTERİM) olmalı, `.code` (KİMLİK) DEĞİL — "50GR" okunmaz, "50 gr" okunur.
 */
export interface FasonWorkInstruction {
  name: string;
  value?: string | null;
}

/**
 * İş emrinin hedef özelliklerini, sevkin gittiği ADIMIN istasyon yetenekleriyle
 * kesiştirir.
 *
 * @param db        Prisma istemcisi ya da tx (freeze sevk tx'inin İÇİNDEN de çağrılır).
 * @param stationId `SubcontractorDispatch.step.stationId` — sevkin gittiği adım.
 * @param targets   `WorkOrder.targetProperties` (propertyId + ad).
 */
export async function resolveStepWorkInstructions(
  db: PrintedDocDb,
  stationId: string,
  targets: Array<{ propertyId: string; name: string }>,
): Promise<FasonWorkInstruction[]> {
  // Hedef yoksa sorgu koşmaz — belge üretimi sıcak yolda (her freeze/reissue/
  // lazy-init) çağrılıyor, boş kümede DB'ye gitmek bedava değil.
  if (!targets.length) return [];

  // ⚠️ `db` bir TRANSACTION istemcisi olabilir → `Promise.all` YASAK (perf kuralı
  // 11: pg adapter tek connection'ı seri çalıştırır). Tek sorgu, seri.
  const caps = await db.stationProperty.findMany({
    where: { stationId },
    select: { propertyId: true },
  });
  const allowed = new Set(caps.map((c) => c.propertyId));

  return targets
    .filter((t) => allowed.has(t.propertyId))
    .map((t) => ({ name: t.name }))
    // ⚠️ Sıra JS'te kurulur, Prisma `orderBy`ına GÜVENİLMEZ: `orderBy`sız bir
    // ilişkide satır sırası garanti değildir ve sıra oynadığında freeze ile
    // reissue aynı içeriği FARKLI sırada basar (`isTemplateStale` yanlış
    // "değişmiş" der, belge parmak izi kayar).
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/**
 * "BOYANACAK RENK" satırının değeri — hedef renk, BU ADIMIN işi olduğu sürece.
 *
 * ⚠️ NEDEN SÜZGEÇ GEREKİYOR (2026-08-15 doğrulama turunda eklendi): işlemler
 * tarafına kurulan "bu adımın işini anlat" kuralı renk tarafında YOKTU —
 * `WorkOrder.targetColor` doğrudan basılıyordu. Bu, hedef alanı ayırmakla
 * kapatılmayan İKİNCİ bir yalan yoludur: rota Boyahane→Zımpara ise (canlıda
 * `ZIMPARA` kategorisi AKTİF ve `appliesColor=false`, `station_properties`
 * satırı sıfır) zımparacıya giden çekinin ÜZERİNDEKİ TEK TALİMAT
 * "BOYANACAK RENK : MAVİ" olurdu — zımparacı boya yapmaz. Bugün canlıda 0 vaka
 * (94/94 sevk Boyahane, `appliesColor=true`) → süzgeç bugün hiçbir satırı
 * elemiyor, yarınki tek koruma.
 *
 * ⚠️ YÜKLEM PROJENİN KANONİK YÜKLEMİDİR ve fason KABULÜYLE aynıdır
 * (`receiveFromSubcontractor`: `!!step.requiredCategory?.appliesColor`). Yani
 * kâğıt tam olarak sistemin kabulde uygulayacağı şeyi söyler — ayrışsalardı
 * belge "boya" derken kabul rengi hiç yazmazdı. Kategori NULL → fail-closed
 * (kabul de o durumda renk kopyalamaz).
 */
export function resolveStepDyeColor(
  step: {
    requiredCategory?: { appliesColor: boolean } | null;
    /** Adım "fasona renksiz gitsin" işaretli mi (2026-08-17 "ekru" kuralı). */
    dispatchWithoutColor?: boolean | null;
  },
  targetColorName: string | null,
): string | null {
  if (!targetColorName) return null;
  // ⚠️ İşaret KATEGORİ SÜZGECİNDEN ÖNCE bakılır ve onu EZER. Planlamacı bu
  // adımda "renk yazma" dedi; kategori boya yapıyor olsa bile kâğıda renk
  // BASILMAZ. Sipariş/iş emri rengi (ör. EKRU) yerinde kalır — o renk gerçekte
  // boyanmıyor, kimyasal işlemin sonucu olarak adlandırılıyor.
  if (step.dispatchWithoutColor) return null;
  return step.requiredCategory?.appliesColor ? targetColorName : null;
}
