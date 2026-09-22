// =============================================================================
// NUMARA SERİSİ — PANELE BAKAN OKUMA YÜZEYİ
// =============================================================================
// `number-series.service.ts`ten AYRILDI (2026-09-22, boyut tavanı). Bölme ekseni
// ÜRETİM ↔ PANEL: servis numarayı ÜRETİR ve biçimi YAZAR; burası panelin
// "hangi seri, bugün düzenlenebilir mi, kaç kaydı etkiler" sorusunu cevaplar.
//
// ⚠️ TEK YÖNLÜ BAĞ: bu dosya servisi import eder, servis BUNU ETMEZ. Ters bağ
// döngü kurardı; panel yüzeyi zaten servisin ÜSTÜNDE bir katman.
//
// ⚠️ `editable` ile yazma kapısı AYNI yüklemden (`seriesLock`) beslenmek
// ZORUNDA: ayrışırlarsa ekran seriyi açık gösterir ve uç 400 döner — bu depoda
// adı konmuş "ayrışan yüzey" sınıfı.
// =============================================================================
import { FAZ_B_ONCESI, scanningClientsCarryFazB } from "../../config/client-version-policy";
import {
  NUMBER_SERIES_CATALOG,
  numberSeriesCatalogEntry,
  type NumberSeriesKind,
} from "../../constants/number-series-catalog";
import prisma from "../../lib/prisma";
import { previewSeriesCode, resolveSeriesFormat } from "../number-series.service";
import type { NumberSeriesFormat } from "./series-format.helper";

/**
 * Serinin BUGÜN düzenlenebilir olup olmadığı ve OLMADIYSA neden.
 *
 * ⚠️ Üç ayrı "hayır" var ve panelde de AYRI cümlelerle görünmeli, çünkü üçü
 * farklı gün kalkar:
 *   · `YAPISAL`  — hiç kalkmayabilir (top barkodunun faz harfi)
 *   · `SAYAC`    — biz hazırlayınca kalkar (çağrı yeri zengin biçime geçince)
 *   · `ISTEMCI`  — fabrika güncelleyince kalkar (panel + tablet sürümü)
 * Sıra `updateSeriesFormat`taki kapı sırasıyla AYNI: önce kullanıcının
 * çözemeyeceği engel.
 */
export type SeriesLockKind = "YAPISAL" | "SAYAC" | "ISTEMCI";

export function seriesLock(key: string): { kind: SeriesLockKind; reason: string } | null {
  const e = numberSeriesCatalogEntry(key);
  if (e.lockedReason) return { kind: "YAPISAL", reason: e.lockedReason };
  if (!e.scopedCounter) {
    return {
      kind: "SAYAC",
      reason:
        "Bu serinin sayacı biçim değişimine hazır değil; numarayı üreten yol kapsam damgasına geçirilmeli.",
    };
  }
  if (e.kind && !scanningClientsCarryFazB()) {
    return {
      kind: "ISTEMCI",
      reason:
        `Okutulan bir seri: sahadaki panel ve tabletler güncellenmeden değiştirilemez ` +
        `(en düşük sürüm panelde ${FAZ_B_ONCESI.electron}, tablette ${FAZ_B_ONCESI.mobil} üstüne çıkmalı).`,
    };
  }
  return null;
}

/**
 * ETKİ SAYISI — "bugüne kadarki N kaydın numarası DEĞİŞMEZ" cümlesinin kaynağı.
 *
 * ⚠️ Sayı UYDURULMAZ: kataloğunda `countTable` olmayan seri `null` döner ve
 * panel sayı YAZMAZ. "0" demek, ölçülmemiş bir şeye sıfır demek olurdu.
 */
export async function seriesImpactCount(key: string): Promise<number | null> {
  const e = numberSeriesCatalogEntry(key);
  if (!e.countTable) return null;
  const delegate = (prisma as unknown as Record<string, { count: (a?: unknown) => Promise<number> }>)[
    e.countTable.model
  ];
  if (!delegate) return null;
  // BELGE ÇAPASI — tekil kayıt ya da grup lideri. Kolon-kolon karşılaştırma
  // prisma alan referansıyla kurulur (katalog buna bağlanamaz, adını yazar).
  if (e.countTable.kapsam === "belge-capasi") {
    return delegate.count({
      where: {
        returnNo: { not: null },
        OR: [{ returnGroupId: null }, { returnGroupId: { equals: prisma.rollReturn.fields.id } }],
      },
    });
  }
  // ⚠️ Düz `count()`: `countTable.field` ZORUNLU bir kolon olmak zorundadır, yani
  // tablodaki her satır bu seriyle numaralanmıştır. Nullable bir kolonda "satır
  // sayısı" ile "numaralanmış kayıt sayısı" AYRI şeyler olurdu.
  // Şart burada ÇALIŞMA ANINDA doğrulanamıyor — ölçüldü 2026-09-22: Prisma 7'nin
  // DMMF alan nesnesi `isRequired` TAŞIMIYOR (`{ name, kind, type }`). Bu yüzden
  // sözleşme BEKÇİYE taşındı: `test_number_series_panel §4` her `countTable`
  // alanını `schema.prisma` metninde zorunlu (soru işaretsiz) olarak arar.
  return delegate.count();
}

/** Liste ucu — katalog kimliği + yürürlükteki biçim + örnek. */
export function listSeries(): Array<
  NumberSeriesFormat & {
    key: string;
    label: string;
    kind?: NumberSeriesKind;
    editable: boolean;
    lockedReason?: string;
    lockKind?: SeriesLockKind;
    panelGroup?: "sevkiyat";
    preview: string;
  }
> {
  return NUMBER_SERIES_CATALOG.map((e) => {
    const fmt = resolveSeriesFormat(e.key);
    // ⚠️ `editable` artık YALNIZ `lockedReason`a bakmaz: sayaç hazırlığı ve eski
    // istemci kapısı da "bugün düzenlenemez" der. Panel tek bir yüklemden
    // beslenmeli, yoksa ekran açık gösterip uç 400 döner (ayrışan yüzey).
    const lock = seriesLock(e.key);
    return {
      ...fmt,
      key: e.key,
      label: e.label,
      ...(e.kind ? { kind: e.kind } : {}),
      editable: lock === null,
      ...(lock ? { lockedReason: lock.reason, lockKind: lock.kind } : {}),
      ...(e.panelGroup ? { panelGroup: e.panelGroup } : {}),
      preview: previewSeriesCode(fmt),
    };
  });
}
