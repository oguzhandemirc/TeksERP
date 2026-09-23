// =============================================================================
// EMEKLİ ÖN EK HİJYENİ (K7, 2026-09-23)
// =============================================================================
// `series-write.helper.ts`ten AYRILDI (boyut tavanı). Bölme ekseni ZAMAN:
// orada "bugün ne yazılıyor", burada "dünkü ön eklere ne oluyor".
//
// ⚠️ EMEKLİ LİSTE GEÇMİŞİN BEYANIDIR, ÇÖP KUTUSU DEĞİL: okutma yüzeyi onu
// "eskiden bu ön ek kullanılıyordu" diye okur ve tarama uzayındaki çakışma
// kapısı da sorgular. Listeye giren her değer bir İDDİADIR; iddiasız değer
// (panelde denenip vazgeçilen ön ek) kapıyı gereksiz daraltır.
//
// ⚠️ DÜŞÜRME FAIL-SAFE: bir ön eki listeden çıkarmak, o ön ekle basılmış
// etiketleri OKUTULAMAZ kılar. Bu yüzden karar yalnız ÖLÇÜLMÜŞ SIFIRDA verilir.
// =============================================================================
import { NUMBER_SERIES_CATALOG, numberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import prisma from "../../lib/prisma";

/**
 * BU ÖN EK GERÇEKTEN KOD ÜRETMİŞ Mİ? (K7 — emekli liste hijyeni)
 *
 * ⚠️ ÜÇ SONUÇLU ve bu LOAD-BEARING: `0` (hiç üretmemiş) · `n>0` (üretmiş) ·
 * `null` (ÖLÇÜLEMEDİ — serinin sayım kaynağı yok). Emekli listeden bir ön ek
 * DÜŞÜRMEK, o ön ekle basılmış etiketleri okutulamaz kılar; karar bu yüzden
 * yalnız ÖLÇÜLMÜŞ SIFIRDA verilir, "bilmiyorum"da ön ek KORUNUR.
 *
 * `seriesImpactCount`ın kardeşi ama AYRI bir soru: orası "bu SERİ kaç kayıt
 * numaraladı", burası "bu ÖN EK kaç kayıt numaraladı".
 */
export async function seriesPrefixUsage(key: string, prefix: string): Promise<number | null> {
  const e = numberSeriesCatalogEntry(key);
  if (!e.countTable || prefix === "") return null;
  const delegate = (prisma as unknown as Record<string, { count: (a?: unknown) => Promise<number> }>)[
    e.countTable.model
  ];
  if (!delegate) return null;
  // `gte` index seek içindir, `startsWith` collation-bağımsız tam ön ek —
  // üreteçlerin ve `seriesImpactCount`ın kanıtlı kalıbı.
  return delegate.count({ where: { [e.countTable.field]: { gte: prefix, startsWith: prefix } } });
}

/**
 * EMEKLİ LİSTENİN YENİ HÂLİ — saf yüklem (K7).
 *
 * Üç kural, üçü de ÖLÇÜLMÜŞ bir zarardan doğdu (d3 panel turu, 2026-09-23):
 *   ① Yürürlükteki ön ek listede DURAMAZ — eski ön eke DÖNMEK onu listeden
 *      çıkarır. Ölçülen bozuk satır: `prefix=PRT`, `retired={PRT,ZQ}`.
 *   ② Kod ÜRETMEMİŞ ön ek emekliye AYRILMAZ — panelde denenip vazgeçilen değer
 *      (`ZQ`) kalıcı çöp bırakıyordu ve tarama uzayını gereksiz daraltıyordu.
 *   ③ ÖLÇÜLEMEYEN ön ek KORUNUR: emekli liste okutmayı ayakta tutar, "emin
 *      değilim" hâlinde düşürmek sahadaki etiketi tanınmaz kılardı (fail-safe).
 */
export function retiredPrefixesAfterChange(args: {
  mevcutEmekliler: readonly string[];
  mevcutOnEk: string;
  yeniOnEk: string;
  /** `null` = ölçülemedi ⇒ ön ek KORUNUR (emekliye ayrılır). */
  mevcutOnEkKullanimi: number | null;
}): string[] {
  const { mevcutEmekliler, mevcutOnEk, yeniOnEk, mevcutOnEkKullanimi } = args;
  const list = [...mevcutEmekliler];
  if (yeniOnEk !== mevcutOnEk && (mevcutOnEkKullanimi === null || mevcutOnEkKullanimi > 0)) {
    list.push(mevcutOnEk);
  }
  // ① Yürürlükteki ön ek listede duramaz — DB sedi de bunu arar
  // (`number_series_retired_not_current`, çift yüklem).
  return [...new Set(list.filter((p) => p !== yeniOnEk && p !== ""))];
}

/** Onarım planı — bir serinin emekli listesinden düşecekler ve GEREKÇELERİ. */
export interface RetiredPrefixCleanupPlan {
  key: string;
  label: string;
  onceki: string[];
  sonraki: string[];
  gerekceler: string[];
}

/**
 * KİRLİ EMEKLİ LİSTE ONARIM PLANI (K7) — yalnız OKUR, yazmaz.
 *
 * ⚠️ CLI'da değil BURADA çünkü ölçülmesi gereken şey KOMUT değil YÜKLEMDİR:
 * bekçi `npx tsx scripts/fix_...` koşturarak bir planı doğrulayamaz, ama bu
 * fonksiyonu kirli bir satıra karşı çağırabilir.
 *
 * Düşürme ÜÇ SONUÇLU ölçüme dayanır (kullanım 0 / >0 / ölçülemedi) ve TOHUM
 * emekli ön ekler (katalogda beyanlı; bugün `workOrder` → `RK`) hiç düşmez:
 * onlar bir GEÇMİŞ BEYANIDIR — fabrika kopyasında `RK` ile başlayan tek bir iş
 * emri yok (ölçüldü 2026-09-23: 0 / 417) ama basılı `RK` kartları sahada
 * okutuluyor. "Veritabanında yok" ile "dünyada yok" aynı şey değildir.
 */
export async function planRetiredPrefixCleanup(
  /**
   * SATIRLAR ENJEKTE EDİLEBİLİR — varsayılan canlı tablo.
   *
   * ⚠️ Yalnız ÖLÇÜM içindir: karar yüklemini sınamak için bekçi eskiden canlı bir
   * satırı geçici olarak KİRLETİYORDU ve eşzamanlı koşan ikinci bir kopya o
   * pencerede kirli veri görüyordu (§4c'nin aralıklı kırmızısıyla aynı sınıf).
   * Üretim çağıranı hiçbir şey geçirmez.
   */
  satirlar?: ReadonlyArray<{ key: string; prefix: string; retiredPrefixes: string[] }>,
): Promise<RetiredPrefixCleanupPlan[]> {
  const rows =
    satirlar ??
    (await prisma.numberSeries.findMany({
      select: { key: true, prefix: true, retiredPrefixes: true },
      orderBy: { key: "asc" },
    }));
  const planlar: RetiredPrefixCleanupPlan[] = [];
  for (const satir of rows) {
    // Katalogda olmayan satır (eski anahtar) DOKUNULMAZ: neyi numaraladığı
    // bilinmiyorsa hangi ön ekin kullanıldığı da bilinemez.
    const entry = NUMBER_SERIES_CATALOG.find((e) => e.key === satir.key);
    if (!entry) continue;
    const tohum = new Set(entry.seedRetiredPrefixes ?? []);
    const gerekceler: string[] = [];
    const sonraki: string[] = [];
    for (const onek of satir.retiredPrefixes) {
      if (onek === satir.prefix) {
        gerekceler.push(`"${onek}" YÜRÜRLÜKTEKİ ön ek — emekli listede duramaz`);
        continue;
      }
      if (tohum.has(onek)) {
        sonraki.push(onek);
        gerekceler.push(`"${onek}" katalogda TOHUM emekli — korunur (saha beyanı)`);
        continue;
      }
      const kullanim = await seriesPrefixUsage(satir.key, onek);
      if (kullanim === null) {
        sonraki.push(onek);
        gerekceler.push(`"${onek}" ÖLÇÜLEMEDİ (sayım kaynağı yok) — korunur`);
      } else if (kullanim > 0) {
        sonraki.push(onek);
        gerekceler.push(`"${onek}" ${kullanim} kayıt üretmiş — korunur`);
      } else {
        gerekceler.push(`"${onek}" hiç kod üretmemiş (ölçüldü: 0) — düşürülür`);
      }
    }
    const degisti =
      sonraki.length !== satir.retiredPrefixes.length ||
      sonraki.some((p, i) => p !== satir.retiredPrefixes[i]);
    if (degisti) {
      planlar.push({ key: satir.key, label: entry.label, onceki: [...satir.retiredPrefixes], sonraki, gerekceler });
    }
  }
  return planlar;
}
