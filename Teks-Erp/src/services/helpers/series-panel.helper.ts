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
  NUMBER_SERIES_PANEL_GROUPS,
  numberSeriesCatalogEntry,
  numberSeriesPanelGroupLabel,
  type NumberSeriesKind,
  type NumberSeriesPanelGroup,
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
  // SERİ ÖN EKİ — aynı tabloyu birden çok seri paylaşıyor (bugün üç tablo, on
  // seri: `Invoice.docNo` ×4 · `Cheque.docNo` ×4 · `Payment.docNo` ×2). Düz
  // `count(*)` dördünün TOPLAMINI basardı; sayım BU serinin ön ekiyle başlayan
  // kodlarla sınırlanır. EMEKLİ ön ekler DAHİL: ön ek değiştikten sonra eski
  // kayıtlar emekli ön ekle duruyor ve onlar da bu serinin numarasını taşıyor.
  //
  // ⚠️ Tarih segmenti YOK: kapsam "bu seriyle numaralanmış HER kayıt"tır, bugün
  // doğanlar değil. Bu yüzden `seriesPrefix()` (tarihli) değil `fmt.prefix`.
  // `gte` index seek içindir, `startsWith` collation-bağımsız tam ön ektir —
  // üreteçlerin kanıtlı kalıbı.
  if (e.countTable.kapsam === "seri-onekli") {
    const fmt = resolveSeriesFormat(key);
    const alan = e.countTable.field;
    return delegate.count({
      where: {
        OR: [fmt.prefix, ...fmt.retiredPrefixes].map((onek) => ({
          [alan]: { gte: onek, startsWith: onek },
        })),
      },
    });
  }
  if (e.countTable.kapsam !== undefined) {
    // ⚠️ TANINMAYAN KAPSAM = FAIL-CLOSED "ölçülemedi" (null), "hepsini say" DEĞİL:
    // yeni bir kapsam adı eklenip burası unutulursa panel sessizce YANLIŞ bir
    // sayı basardı. `never` ataması aynı unutmayı DERLEME ANINDA da yakalar.
    const tanimsiz: never = e.countTable.kapsam;
    void tanimsiz;
    return null;
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

/**
 * SAYAÇ YETENEKLERİ — panel satır başına BUNU okur, kendi hesaplamaz.
 *
 * ⚠️ `reset` HER ZAMAN kapalı ve bu bir EKSİKLİK DEĞİL, ÖLÇÜLMÜŞ bir sonuç
 * (2026-09-23): aynı ön ek ve tarih döneminde numaralar `@unique`, sayaç 1'e
 * döndürülse bile atlama döngüsü eski maksimuma kadar yürüyor ve sonuç
 * DEĞİŞMİYOR. Yani "sıfırla" düğmesi sessiz bir "hiçbir şey olmadı" üretirdi.
 * Ekranda GEREKÇESİYLE kapalı durur — "neden yok?" sorusunun ekranda cevabı
 * olmaz, "neden kapalı?" sorusununki olur (numaralandırma ekranının C3 kararı).
 */
export interface SeriesCounterCapabilities {
  startValue: boolean;
  step: boolean;
  maxValue: boolean;
  reset: false;
  /** Ayarlar kapalıysa NEDEN (kendi sayaç mekanizması). */
  lockedReason?: string;
  /** `reset` neden hep kapalı — ölçülmüş cümle, panelde birebir gösterilir. */
  resetReason: string;
}

const RESET_REASON =
  "Sayaç geriye alınamaz: aynı ön ek ve tarih döneminde üretilmiş numaralar tekildir, " +
  "sıra 1'e döndürülse bile ilk boş numaraya kadar ilerler ve sonuç değişmez. " +
  "İleri almak için başlangıç değerini bugünkü en büyük numaranın üstüne yazın.";

export function seriesCounterCapabilities(key: string): SeriesCounterCapabilities {
  const e = numberSeriesCatalogEntry(key);
  const open = e.ownCounter === undefined;
  return {
    startValue: open,
    step: open,
    maxValue: open,
    reset: false,
    ...(e.ownCounter ? { lockedReason: e.ownCounter.not } : {}),
    resetReason: RESET_REASON,
  };
}

/**
 * NUMARA KAYNAĞI YETENEĞİ — ayar YALNIZ elle yolu olan seride çizilir.
 *
 * ⚠️ Yeteneği olmayan seride panel alanı HİÇ ÇİZMEZ (pasif de çizmez): kimsenin
 * değiştiremeyeceği bir kutuyu 48 kez göstermek gürültüdür. Bu, kilitli BİÇİM
 * satırının tersidir ve fark bilinçli: orada kullanıcı "neden kilitli?" diye
 * sorar (cevabı var), burada ayarın kendisi o seri için ANLAMSIZDIR.
 */
export interface SeriesSourceCapability {
  editable: boolean;
  value: "FREE" | "SYSTEM" | "MANUAL";
  /** Elle yolunun yeri — beyan; panelde gösterilmez, bekçi okur. */
  manualPath?: string;
}

export function seriesSourceCapability(key: string): SeriesSourceCapability {
  const e = numberSeriesCatalogEntry(key);
  return {
    editable: e.manualEntry !== undefined,
    value: resolveSeriesFormat(key).numberSource ?? "FREE",
    ...(e.manualEntry ? { manualPath: e.manualEntry.path } : {}),
  };
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
    panelGroup: NumberSeriesPanelGroup;
    /** Bölüm başlığı — panel KOPYALAMAZ, okur (`countBirim` emsali). */
    panelGroupLabel: string;
    /** Etki cümlesinin BİRİMİ — panel bunu KOPYALAMAZ, okur. */
    countBirim?: "kayıt" | "belge";
    /** Sayaç yetenekleri — panel hesaplamaz, okur. */
    counter: SeriesCounterCapabilities;
    /** Numara kaynağı yeteneği — panel hesaplamaz, okur. */
    source: SeriesSourceCapability;
    startValue: number | null;
    step: number | null;
    maxValue: number | null;
    separator2: string | null;
    preview: string;
  }
> {
  // ⚠️ SIRA BACKEND'DE: panel grupları kendi listesine göre dizerse, backend yeni
  // bir grup eklediğinde panelin listesi bayatlar ve grup ya kaybolur ya da sona
  // düşer. Satırlar grup sırasında gelir, panel yalnız ardışık olanları toplar.
  const grupSirasi = new Map(NUMBER_SERIES_PANEL_GROUPS.map((g, i) => [g.key, i]));
  return [...NUMBER_SERIES_CATALOG]
    .sort((a, b) => (grupSirasi.get(a.panelGroup) ?? 0) - (grupSirasi.get(b.panelGroup) ?? 0))
    .map((e) => {
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
      panelGroup: e.panelGroup,
      panelGroupLabel: numberSeriesPanelGroupLabel(e.panelGroup),
      ...(e.countTable ? { countBirim: e.countTable.birim } : {}),
      counter: seriesCounterCapabilities(e.key),
      source: seriesSourceCapability(e.key),
      // ⚠️ `undefined` DEĞİL `null`: tohuma düşen seride alan hiç yoktur ve panel
      // `undefined !== null` yüzünden formu "değişmiş" sanardı (Kaydet düğmesi
      // dokunulmadan açılırdı). Sözleşme tek tip: yok = `null`.
      // Aynı "yok = null" sözleşmesi ikinci ayraç için de geçerli.
      separator2: fmt.separator2 ?? null,
      startValue: fmt.startValue ?? null,
      step: fmt.step ?? null,
      maxValue: fmt.maxValue ?? null,
      preview: previewSeriesCode(fmt),
    };
  });
}
