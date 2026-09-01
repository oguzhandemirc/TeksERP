// =============================================================================
// DEMO SEED — ENVANTER (top havuzu)
// =============================================================================
// ⭐ KABUL ÖLÇÜTÜ (kullanıcı şartı): "demo verilerinde bitmiş topların renksiz
//    olmaması gerekiyor". Bugünkü canlı demoda sevk edilmiş 29 topun 29'u,
//    bitmiş depodaki 39 topun 11'i RENKSİZDİ — çünkü iş emirlerinde hedef renk
//    yoktu ve fason kabulünde `appliedColorId` geçilmemişti.
//
// KURAL BURADA YAPISALDIR, ihtimale bırakılmaz:
//   • HAM stok (`STOCK`, `entrySource=SUPPLIER_RECEIPT`) → renk NULL DOĞRU
//     (ham kumaş boyasız gelir; renk üretimde kazanılır).
//   • BİTMİŞ her statü (`WAREHOUSE`/`A1_STOCK`/`SHIPPED`) → renk ZORUNLU.
// `verify.ts` bunu koşum sonunda ölçer ve ihlalde seed KIRMIZI biter.
//
// ⚠️ DOĞRUDAN PRISMA (servis değil) — bilinçli: bu toplar bir iş emrine BAĞLI
// DEĞİL, envanterin "geçmişten kalan" gövdesidir. Servis yolu (`createInitialEntry`
// → fason → tambur) her top için tablet oturumu, adım/hareket zinciri ve plan
// kapısı ister; 250 top için hem 50s tx sınırına dayanır hem de bağlı olmadıkları
// bir iş emrinin adım sayaçlarını bozar. Defter riski YOK: bu topların
// `currentStepId`/`batchId`/`shipmentId` bağı yoktur, yani `test_consistency`nin
// baktığı türetilmiş alanlara (adım durumu, shippedQty) hiç girmezler.
// =============================================================================
import { RollStatus, RollEntrySource } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { adim, say, not, demoId, gunOnce, yayilmisGun, rastgele, sec, parcala } from "./_kit";

const ADET = 260;

/** Kat kataloğu — liste/etiket yüzeylerinde dolu görünsün. */
const KATLAR = ["2-KAT", "4-KAT", "TUP", null];

export async function envanterKur(itemIds: string[], colorIds: string[]): Promise<void> {
  adim(`Envanter — ${ADET} top (ham · bitmiş · 2.kalite · arşiv)`);
  if (itemIds.length === 0 || colorIds.length === 0) {
    not("Top üretilemedi — kumaş ya da renk kataloğu boş.");
    return;
  }

  const depolar = await prisma.warehouse.findMany({
    where: { isActive: true },
    select: { id: true, isDefault: true },
    orderBy: { isDefault: "desc" },
  });
  if (depolar.length === 0) {
    not("Aktif depo yok — toplar depo damgası alamaz.");
    return;
  }
  const kaliteler = await prisma.qualityGrade.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });
  const kalite = (kod: string) => kaliteler.find((q) => q.code === kod)?.id ?? null;

  const r = rastgele(778899);
  const satirlar: Array<Record<string, unknown>> = [];

  for (let i = 0; i < ADET; i++) {
    const gun = yayilmisGun(i, ADET);
    const dogum = gunOnce(gun);
    const p = r();

    // Dağılım: %26 ham stok · %46 bitmiş depo · %10 2.kalite · %8 şube deposu
    //          · %6 iptal · %4 fire  → Top Arşivi de dolar.
    let status: RollStatus;
    let entrySource: RollEntrySource;
    let renkli: boolean;
    let kaliteId: string | null;

    if (p < 0.22) {
      // HAM STOK — KK1'den ölçülerek giren mal, rotanın başı.
      status = RollStatus.STOCK;
      entrySource = RollEntrySource.SUPPLIER_RECEIPT;
      renkli = false; // ⭐ HAM KUMAŞ RENKSİZ DOĞRU
      kaliteId = null;
    } else if (p < 0.30) {
      // YARI MAMUL — dışarıdan alınan BOYALI kumaş; rafta durur, üretime
      // sokulabilir. Canlı demoda bu sekme SIFIR kayıtlıydı (ölçüldü) ve ekran
      // "özellik yok" gibi görünüyordu.
      status = RollStatus.STOCK;
      entrySource = RollEntrySource.SEMI_FINISHED;
      renkli = true;
      kaliteId = null;
    } else if (p < 0.70) {
      status = RollStatus.WAREHOUSE;
      entrySource = RollEntrySource.TAMBUR_SPLIT;
      renkli = true;
      kaliteId = kalite("1.KALITE");
    } else if (p < 0.80) {
      status = RollStatus.A1_STOCK;
      entrySource = RollEntrySource.TAMBUR_SPLIT;
      renkli = true;
      kaliteId = kalite("A1");
    } else if (p < 0.90) {
      // Fason dönüşü — boyahaneden RENKLİ döner (`appliedColorId` yolunun sonucu).
      status = RollStatus.WAREHOUSE;
      entrySource = RollEntrySource.SUBCONTRACTOR_RETURN;
      renkli = true;
      kaliteId = kalite("1.KALITE");
    } else if (p < 0.96) {
      status = RollStatus.CANCELLED;
      entrySource = RollEntrySource.MANUAL_ENTRY;
      renkli = true;
      kaliteId = null;
    } else {
      status = RollStatus.SCRAP;
      entrySource = RollEntrySource.TAMBUR_MANUAL;
      renkli = true;
      kaliteId = kalite("FIRE");
    }

    const bitmis = status === RollStatus.WAREHOUSE || status === RollStatus.A1_STOCK;
    const metraj = Math.round((60 + r() * 940) * 10) / 10;
    // Şube deposu yalnız bitmiş malda (ham mal merkeze girer).
    const depo = bitmis && p >= 0.82 && depolar[1] ? depolar[1] : depolar[0];

    satirlar.push({
      id: demoId(`roll:${i}`),
      barcode: `DF${String(i + 1).padStart(6, "0")}`,
      itemId: sec(itemIds, r),
      // ⭐ KABUL ÖLÇÜTÜ: bitmiş top DAİMA renkli.
      colorId: renkli ? sec(colorIds, r) : null,
      initialQty: metraj,
      currentQty: metraj,
      weightKg: Math.round(metraj * (0.18 + r() * 0.12) * 100) / 100,
      status,
      entrySource,
      width: 140 + Math.round(r() * 16) * 10,
      foldType: sec(KATLAR, r),
      qualityGradeId: kaliteId,
      warehouseId: depo?.id ?? null,
      // Kalite karnesinin ÇIPASI — `finalizedAt` yoksa bitmiş toplar raporda YOK.
      finalizedAt: bitmis || status === RollStatus.SCRAP ? dogum : null,
      labelPrintedAt: bitmis ? dogum : null,
      entryReason: status === RollStatus.CANCELLED ? "Hatalı kayıt — demo verisi" : null,
      createdAt: dogum,
      updatedAt: dogum,
    });
  }

  // ⚠️ PARÇALI YAZIM: tek `createMany` 260 satırla sorun çıkarmaz ama demo DB'de
  // `statement_timeout=50s` var ve alışkanlık tek yerde kurulur.
  let yeni = 0;
  for (const parca of parcala(satirlar, 50)) {
    const res = await prisma.roll.createMany({
      data: parca as never,
      skipDuplicates: true, // deterministik PK → ikinci koşumda 0 yeni
    });
    yeni += res.count;
  }
  say("top", yeni);

  const dagitim = await prisma.roll.groupBy({
    by: ["status"],
    where: { barcode: { startsWith: "DF" } },
    _count: true,
  });
  console.log(
    "   " + dagitim.map((d) => `${d.status}=${d._count}`).join(" · "),
  );
}
