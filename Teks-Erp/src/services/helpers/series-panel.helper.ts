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
import {
  FAZ_B_ONCESI,
  FAZ_D_ONCESI,
  SCANNED_CLIENT_BREAKING_AXES,
  firstVersionAbove,
  scanningClientsMissingPhases,
  type SeriesFormatAxis,
} from "../../config/client-version-policy";
import {
  NUMBER_SERIES_CATALOG,
  NUMBER_SERIES_PANEL_GROUPS,
  numberSeriesCatalogEntry,
  numberSeriesPanelGroupLabel,
  type NumberSeriesKind,
  type NumberSeriesPanelGroup,
} from "../../constants/number-series-catalog";
import prisma from "../../lib/prisma";
import { rollBarcodePrefix } from "./roll-barcode.helper";
import {
  nextSeriesNo,
  pendingSeriesLine,
  previewSeriesCode,
  resolveSeriesFormat,
} from "../number-series.service";
import { codeCountsForCounter, matchesSeries, type NumberSeriesFormat } from "./series-format.helper";

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

/**
 * KİLİT CÜMLESİNİN TEK KAYNAĞI (2026-09-23).
 *
 * ⚠️ Panel kendi cümlesini YAZMAZ: 2026-09-23'te ölçüldü — tablo satırı panelin
 * kendi metnini ("yapısal olarak değişemez"), diyalog ise sunucunun metnini
 * ("… Faz B inmeden açılmaz") gösteriyordu ve ikisi ÇELİŞİYORDU. Panelde kalan
 * tek şey ROZET (sınıf adı) ve vurgu; cümleler buradan gider.
 *
 * ⚠️ `acilma` AYRI bir alandır, gerekçenin içine gömülmez: kullanıcının sorduğu
 * iki soru ("neden kilitli" · "ne zaman açılır") iki ayrı cümledir ve ikincisi
 * KİMİN işi olduğunu (`kimde`) belirler — ekranda kullanıcının kendi
 * çözebileceği kilit bu yüzden vurgulanır.
 */
export interface SeriesLock {
  kind: SeriesLockKind;
  /**
   * KİLİTLİ EKSENLER — `ISTEMCI` kilidinde hangi ALANLARIN değişemeyeceği.
   *
   * ⚠️ Eski kapı "okutulan her seri tamamen kilitli" diyordu ve bu ÖLÇÜLMEMİŞ bir
   * genellemeydi: eski istemcilerin çoğu yalnız ÖN EKTEN kırılıyor, sevkiyat hiç
   * kırılmıyor (ölçüm: `test_eski_istemci_okutma`). Boş/atlanmış alan = "bütün
   * biçim kilitli" (YAPISAL ve SAYAC kilitlerinde olduğu gibi).
   */
  lockedAxes?: SeriesFormatAxis[];
  /** NEDEN kilitli — kullanıcı diliyle, jargonsuz. */
  reason: string;
  /** NE ZAMAN/NASIL açılır — ölçülebilir koşul, "ileride" değil. */
  acilma: string;
  /** Eylem KİMDE: yalnız "siz"de kullanıcı bir şey yapabilir. */
  kimde: "kimse" | "biz" | "siz";
}

/** Eksen adlarının kullanıcı dili — panelde ve kilit cümlesinde aynı sözcükler. */
const EKSEN_ADI: Record<SeriesFormatAxis, string> = {
  prefix: "ön ek",
  dateSegment: "tarih",
  digits: "hane",
  separator: "ayraç",
  separator2: "ikinci ayraç",
};

function eksenAdlari(eksenler: SeriesFormatAxis[]): string {
  return eksenler.map((a) => EKSEN_ADI[a]).join(" ve ");
}

/**
 * BÜTÜN BİÇİM KİLİTLİ Mİ? — `editable`in, yazma kapısının ve bekçilerin TEK yüklemi.
 *
 * ⚠️ "Kilit var" ile "hiçbir alan değiştirilemez" AYNI ŞEY DEĞİL ve bu ayrım
 * ölçülmüş bir davranıştır: `ISTEMCI` kilidi EKSEN düzeyindedir, yani kartela
 * sevk no bugün yalnız ÖN EKTE kilitlidir ve tarih/hane/ayraç değiştirilebilir
 * (`assertSeriesFormatWritable` seri düzeyinde ancak BEŞ eksen birden kırılıyorsa
 * reddeder). Bu soruyu üç yerde ayrı ayrı yazmak "ayrışan yüzey" sınıfıdır:
 * panelin `editable`ı bir cevaba, bekçinin yüklemi başka bir cevaba yaslanınca
 * kırmızı, kodun değil ÖLÇÜMÜN eskimesinden doğar (ölçüldü 2026-09-23).
 */
export function seriesFullyLocked(key: string): boolean {
  const lock = seriesLock(key);
  if (lock === null) return false;
  return lock.lockedAxes === undefined || lock.lockedAxes.length === 5;
}

export function seriesLock(key: string): SeriesLock | null {
  const e = numberSeriesCatalogEntry(key);
  if (e.lockedReason) {
    return { kind: "YAPISAL", reason: e.lockedReason, acilma: "Bu kilit kalkmayacak.", kimde: "kimse" };
  }
  if (!e.scopedCounter) {
    return {
      kind: "SAYAC",
      // ⚠️ JARGON YASAK: eski cümle ("numarayı üreten yol kapsam damgasına
      // geçirilmeli") DOĞRUYDU ama kullanıcıya hiçbir şey söylemiyordu — kullanıcı
      // "kapsam damgası"nı ne bilir ne de yapabilir. Cümle ne YAPILABİLDİĞİNİ
      // söyler: sayaç ayarları bu seride BUGÜN çalışıyor.
      reason: "Bu serinin biçimi henüz açılmadı; sayaç ayarları kullanılabilir.",
      acilma: "Bir sonraki program güncellemesinde açılacak.",
      kimde: "biz",
    };
  }
  // ⚠️ YAZMA KAPISIYLA AYNI YÜKLEM: `assertSeriesFormatWritable` İKİ eşiğe birden
  // bakar (Faz B "biçimi tablodan oku" · Faz D "emekli BİÇİMLERİ de dene"). Burası
  // yalnız Faz B'ye baksaydı, Faz D eşiği ileri alındığı gün panel seriyi AÇIK
  // gösterir, uç 400 dönerdi — bu dosyanın başlığındaki "ayrışan yüzey" tam olarak
  // budur ve iki eşik AYRI AYRI yükselebildiği için soru gerçekten ayrışabilir.
  const eksik = e.kind ? scanningClientsMissingPhases() : [];
  // ⚠️ KİLİT EKSEN DÜZEYİNDE: hangi alanların eski istemciyi kırdığı ÖLÇÜLDÜ.
  // Kırılan ekseni olmayan seri (bugün `shipment`) hiç kilitlenmez.
  const kiranEksenler = e.kind ? (SCANNED_CLIENT_BREAKING_AXES[key] ?? []) : [];
  if (eksik.length > 0 && kiranEksenler.length > 0) {
    const esik = eksik.includes("B") ? FAZ_B_ONCESI : FAZ_D_ONCESI;
    const hepsi = kiranEksenler.length === 5;
    return {
      kind: "ISTEMCI",
      reason: hepsi
        ? "Okutulan bir seri: sahadaki eski panel ve tablet bu kodun BİÇİMİNİ sabit " +
          "varsaydığı için biçimin hiçbir parçası değiştirilemez."
        : `Okutulan bir seri: sahadaki eski panel/tablet ${eksenAdlari(kiranEksenler)} ` +
          "değişimini okutamıyor; biçimin diğer parçaları değiştirilebilir.",
      acilma:
        `Panel ${firstVersionAbove(esik.electron)} ve tablet ${firstVersionAbove(esik.mobil)} ` +
        "ya da üstü bu bilgisayarlara/tabletlere kurulunca açılır.",
      kimde: "siz",
      lockedAxes: kiranEksenler,
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
export async function seriesImpactCount(
  key: string,
  /**
   * BİÇİM ENJEKSİYONU — varsayılan yürürlükteki biçim.
   *
   * ⚠️ SIRF ÖLÇÜM İÇİN VAR ve bu bilinçli: "emekli ön ekle yazılmış kayıt da
   * sayılıyor mu" sorusunu ölçmenin tek yolu, emekli listesi DOLU bir biçimle
   * saydırmaktı. Bekçi bunu `number_series` satırını geçici olarak DEĞİŞTİREREK
   * yapıyordu; satır GLOBAL olduğu için aynı bekçinin iki koşumu çakıştığında
   * biri ötekinin emekli ön ekini siliyor ve ARALIKLI kırmızı doğuyordu
   * (ölçüldü 2026-09-23: üç kırmızı, ardından iki temiz koşum). Parametre,
   * ölçümün yan etkisini sıfıra indirir — üretim çağıranları hiçbir şey
   * geçirmez ve davranış değişmez.
   */
  fmtOverride?: NumberSeriesFormat,
): Promise<number | null> {
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
    const fmt = fmtOverride ?? resolveSeriesFormat(key);
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

/**
 * PANELDE GÖSTERİLECEK ÖRNEK KOD — üreteci olan seride O ÜRETEÇTEN.
 *
 * ⚠️ `previewSeriesCode` yalnız BİÇİMİ uygular; katalogdaki `infix` (bugün top
 * barkodunun H/F faz harfi) bir YAPI parçasıdır ve önizlemede düşerdi. Sonuç,
 * ekranda gerçekte hiç üretilmeyen bir kod göstermekti — "örnek kod literali
 * yazma" kuralının aynı sınıftaki kardeşi: yanlış yoldan türetmek de yalandır.
 */
function seriesOrnekKod(key: string, fmt: NumberSeriesFormat): string {
  if (key === "roll") return `${rollBarcodePrefix("H")}0001`;
  return previewSeriesCode(fmt);
}

/**
 * BU SERİNİN BUGÜNKÜ BİÇİMİ OKUTULAN BİR SERİYLE ÇAKIŞIYOR MU? (bilgi, engel DEĞİL)
 *
 * ⚠️ Kapı bu çakışmayı ENGELLEMEZ (devralınmış olabilir; yeni bir kural var olan
 * ayarı bir anda kaydedilemez yapamaz) ama SUSMAZ da: bugün `cashAccount` (`KS`)
 * ile `kartelaDispatch` (`KS`) bu durumda ve fark, bilerek bırakılmış bir çakışma
 * ile bilmeden bırakılmış olan arasındadır.
 */
function scanOverlapLabel(key: string, fmt: NumberSeriesFormat): string | null {
  const kod = previewSeriesCode(fmt);
  for (const other of NUMBER_SERIES_CATALOG) {
    if (other.key === key || !other.kind) continue;
    if (matchesSeries(resolveSeriesFormat(other.key), kod)) return other.label;
  }
  return null;
}

/**
 * SIRADAKİ NUMARA — sayacı TÜKETMEDEN, üretim yolunun KENDİ hesabıyla (K19).
 *
 * ⚠️ Ekrandaki "Örnek" hep sıra 1'i gösteriyordu ve kullanıcı onu SIRADAKİ numara
 * sanıyordu (d3 ölçtü 2026-09-23: ekranda `PZ-1`, oysa açılan kayıt `PZ-4`). İki
 * satır iki ayrı soruyu cevaplar: biçim örneği ("kod neye benzeyecek") ve sıradaki
 * numara ("bir sonraki kayıt hangi numarayı alacak").
 *
 * ⚠️ ÜÇ SONUÇ: kendi sayaç mekanizması olan seri (`ownCounter`) ve sayım kaynağı
 * olmayan seri `null` döner — ekran "—" yazar, sayı UYDURMAZ.
 *
 * ⚠️ ÖNİZLEMEDİR, REZERVASYON DEĞİL: numara üretim anında tx içinde belirlenir;
 * arada doğan bir kayıt sıradakini alabilir. Yazma yapmaz.
 */
export async function previewNextNumber(
  key: string,
  fmtOverride?: NumberSeriesFormat,
): Promise<string | null> {
  const e = numberSeriesCatalogEntry(key);
  if (e.ownCounter || !e.countTable) return null;
  const delegate = (prisma as unknown as Record<string, { findMany: (a?: unknown) => Promise<unknown[]> }>)[
    e.countTable.model
  ];
  if (!delegate) return null;
  const alan = e.countTable.field;
  try {
    return await nextSeriesNo(
      key,
      async (fullPrefix, fmt) => {
        const rows = (await delegate.findMany({
          where: { [alan]: { gte: fullPrefix, startsWith: fullPrefix } },
          select: { [alan]: true, createdAt: true },
        })) as Array<Record<string, unknown>>;
        // ⚠️ `{ code, createdAt }` biçimine ÇEVİRİLİR: kapsam damgası (createdAt)
        // olmadan sayaç eski rejimin kodlarını da sayardı — üretim yolunun aynı
        // sözleşmesi (`SeriesCodeRow`).
        // ⚠️ SÜZGEÇ DE ÜRETİM YOLUYLA AYNI (K19/K27): önizleme ile üretim farklı
        // yüklemlerden beslendiğinde ekran "sıradaki numara" der, yazma başka bir
        // numara üretir — ürün kodunda tam olarak bu yaşandı (ekran STKZ-000002,
        // üretim STKZ-000001'de ısrar edip P2002'ye çarptı).
        return rows
          .map((r) => ({
            code: (r[alan] as string | null) ?? null,
            createdAt: r.createdAt as Date,
          }))
          .filter((r) => r.code === null || codeCountsForCounter(fmt, r.code));
      },
      new Date(),
      fmtOverride,
    ).then((kod) => kod);
  } catch {
    // Sıra tükenmesi gibi hâller ÖNİZLEMEYİ düşürmez: "—" gösterilir.
    return null;
  }
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
    /** Kilit NE ZAMAN kalkar — panel cümleyi KOPYALAMAZ, okur. */
    lockUnlock?: string;
    /** Kilitli ALANLAR — panel yalnız bunları pasifleştirir. */
    lockedAxes?: SeriesFormatAxis[];
    /** Eylem kimde ("kimse" | "biz" | "siz") — rozet vurgusu buradan. */
    lockActor?: "kimse" | "biz" | "siz";
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
    /** Vadesi gelmemiş biçim değişikliği — panel "bekleyen değişiklik" satırı. */
    pending?: { effectiveFrom: string; preview: string };
    /**
     * DEVRALINAN ÇAKIŞMA — bu serinin bugünkü biçimiyle üretilen kod, OKUTULAN
     * başka bir serininkine de uyuyor. Engellenmiyor (yeni kural eski ayarı
     * kaydedilemez yapamaz) ama kullanıcıya SÖYLENİYOR: bilmeden bırakılmış bir
     * çakışma ile bilerek bırakılmış olan arasındaki fark budur.
     */
    scanOverlapWith?: string;
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
      // ⚠️ `editable` "hiçbir alan değiştirilemez" demek: eksen kilidinde biçimin
      // BİR KISMI açıktır, o yüzden satır düzenlenebilir sayılır ve panel yalnız
      // kilitli ALANLARI pasifleştirir.
      editable: !seriesFullyLocked(e.key),
      ...(lock
        ? {
            lockedReason: lock.reason,
            lockKind: lock.kind,
            lockUnlock: lock.acilma,
            lockActor: lock.kimde,
            ...(lock.lockedAxes ? { lockedAxes: lock.lockedAxes } : {}),
          }
        : {}),
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
      // ⚠️ ÖRNEK KENDİ ÜRETECİNDEN: `previewSeriesCode` katalog `infix`ini YAZMAZ
      // (top barkodunun faz harfi), yani düz türetme `T2309260001` gibi GERÇEKTE
      // ÜRETİLMEYEN bir kod gösteriyordu — gerçeği `T140926H0113` (d3 ölçtü
      // 2026-09-23). Üreteci olan seride örnek O ÜRETEÇTEN kurulur.
      preview: seriesOrnekKod(e.key, fmt),
      ...(() => {
        const p = pendingSeriesLine(e.key);
        return p
          ? {
              pending: {
                effectiveFrom: p.effectiveFrom.toISOString(),
                preview: previewSeriesCode({ ...fmt, ...p.fmt }),
              },
            }
          : {};
      })(),
      ...(() => {
        const ortak = scanOverlapLabel(e.key, fmt);
        return ortak ? { scanOverlapWith: ortak } : {};
      })(),
    };
  });
}
