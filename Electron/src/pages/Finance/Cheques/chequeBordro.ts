// =============================================================================
// ÇEK / SENET TESLİM BORDROSU — seçim kuralları + tek dışa aktarım spec'i
// =============================================================================
// NE ÜRETİR: ekranda SEÇİLEN çek/senetlerden yazdırılabilir bir teslim bordrosu
// (elden teslim tutanağı) — `ReportExportSpec` olarak. Excel, PDF ve yazıcı
// çıktısı O TEK SPEC'ten türer (`Reports/_components/reportExport.ts` başlığı);
// bordroya özel el yapımı bir HTML YAZILMAZ. Alternatifi bu projede bir kez
// ısırdı: aynı başlık altında iki farklı rakam taşıyan iki dosya, ikisi de
// ayrı ayrı "çalışıyor" göründüğü için kimse fark etmez.
//
// ⚠️ ANLIK ÇIKTIDIR — DONMUŞ RESMİ BELGE (`PrintedDocument`) DEĞİL. Bir bordro
// GRUBUNU sahiplenen kaynak model yok: donmuş belge `docType + sourceId`
// isterken burada "kaynak" yalnız kullanıcının o anki seçimidir. Bu yüzden
// bordronun sistemde belge numarası, sürümü ve revizyon geçmişi YOKTUR ve
// aynı seçimle iki kez basmak iki ayrı olay üretmez. Bu gerçek KAĞIDIN
// ÜSTÜNE de basılır (`meta`) — belgeyi elinde tutan kişi, ekrandaki çekin
// durumunun sonradan değişmiş olabileceğini bilmeli. Resmi/donmuş sürüm
// istenirse çözüm bu dosyayı büyütmek değil, bordro grubunu taşıyan bir
// kaynak model açmaktır (yol haritasında J kararı).
//
// ⚠️ BİR BORDRO TEK YÖN TAŞIR (aldığımız ⊻ verdiğimiz). Karışık seçimde
// TOPLAM iki ayrı şey demeye başlar — bir yanda elimizdeki alacak kıymetleri,
// öbür yanda kendi borç senetlerimiz — ve altındaki "teslim alan" imzası neyin
// teslim alındığını söylemez olur. Pratikte de iki yön farklı karşı tarafa
// gider (biri bankaya tahsile / cirolanacak firmaya, diğeri borçlu olduğumuz
// firmaya). Kural İKİ KATMANDA yaşar: seçim ekranı kutuyu kapatır ve sebebini
// yazar (`selectionBlockReason`), üretici ise fail-closed olarak REDDEDER
// (`bordroBlockReason` → `buildChequeBordro` fırlatır). Ekran katmanı bir
// nezakettir; kuralı koruyan üreticidir.
//
// ⚠️ İPTAL EDİLMİŞ KAYIT BORDROYA GİREMEZ. Portföy dışa aktarımında iptal satırı
// listede DURUR ama toplama girmez (orada belge bir DÖKÜMDÜR); bordro ise bir
// TESLİM TUTANAĞIDIR — resmen "yok" sayılmış bir kâğıdı teslim edilenler
// listesine yazmak, karşı tarafa var olmayan bir kıymet için imza attırmaktır.
//
// ⚠️ FARKLI PARA BİRİMLERİ TOPLANMAZ. Tek toplam YALNIZ liste tek para
// birimindeyken yazılır; her durumda adet + para birimi bazlı toplamlar nota
// düşer (karışık listede sayının kendisi kaybolmasın diye).
//
// ⚠️ İMZA/TESLİM ALANLARI `notes` ile basılır — ortak render'ın dışına çıkan
// özel bir HTML bloğu değil. Bordroya yeni bir alan gerekirse önce `notes`/
// `meta` ile çözülür.
// =============================================================================

import type { ReportColumn, ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { KIND_LABEL } from "./labels";
import { toNum, type ChequeKind, type ChequeRow } from "./service";

const MONEY = "#,##0.00";

/**
 * Bordro kolonları — bilinçli olarak DAR ve teslim tutanağının sorusuna göre
 * seçilmiş: karşı taraf hangi kâğıdı aldığını (belge/seri no), ne zaman
 * paraya döneceğini (keşide/vade), kimin borçlandığını (keşideci/banka) ve
 * ne kadar için imza attığını (para birimi + tutar) görmeli.
 *
 * ⚠️ İKİ BİLGİ TAŞIYAN HÜCRE BÖLÜNÜR (`chequeExport.ts` ile aynı gerekçe):
 * ekranda yerden kazanmak için tek hücreye konan "Keşide / Vade" ve
 * "Keşideci / Banka" burada AYRI kolonlardır — iki tarih taşıyan bir hücre
 * sıralanamaz, süzülemez ve tarih olarak toplanamaz.
 */
const COLUMNS: ReportColumn[] = [
  { header: "Sıra", key: "no", width: 6, align: "right" },
  { header: "Belge No", key: "docNo", width: 16 },
  { header: "Seri No", key: "serialNo", width: 14 },
  { header: "Keşide", key: "issueDate", width: 12 },
  { header: "Vade", key: "dueDate", width: 12 },
  { header: "Keşideci", key: "drawer", width: 26 },
  { header: "Banka", key: "bank", width: 22 },
  { header: "Para", key: "currency", width: 7 },
  { header: "Tutar", key: "amount", width: 16, numFmt: MONEY, align: "right" },
];

/** Seçim kuralları yalnız bu üç alana bakar — tam satır gerekmez. */
export type SelectableCheque = Pick<ChequeRow, "id" | "kind" | "status">;

export const BORDRO_MIXED_KIND_ERROR =
  "Bir teslim bordrosu TEK YÖN taşır: aldığımız çek/senetler ile verdiğimiz çek/senetler aynı bordroya giremez.";

export const BORDRO_EMPTY_ERROR = "Bordro için listeden en az bir çek/senet seçin.";

// -----------------------------------------------------------------------------
// SEÇİM KURALLARI (ekran katmanı)
// -----------------------------------------------------------------------------

/**
 * Seçimin KİLİTLEDİĞİ yön — seçim boşken `null` (her iki yön de serbest).
 *
 * Kilidi ilk seçilen satır kurar; kural bundan sonra "aynı yön" der. Yönü
 * seçimin ortasında değiştirmek sessizce bir satırı düşürmek ya da iki yönü
 * karıştırmak demekti — ikisi de kullanıcının fark edemeyeceği kayıplar.
 */
export function selectionKind(selected: readonly Pick<ChequeRow, "kind">[]): ChequeKind | null {
  return selected[0]?.kind ?? null;
}

/**
 * Bu satır seçime EKLENEMİYORSA sebebi; eklenebiliyorsa `null`.
 *
 * ⚠️ Sebep DÖNDÜRÜLÜR, `false` değil: kapalı bir kutu tek başına "bozuk"
 * okunur. Ekran kutuyu kapatırken bu cümleyi de yazar.
 */
export function selectionBlockReason(
  row: Pick<SelectableCheque, "kind" | "status">,
  lockedKind: ChequeKind | null,
): string | null {
  if (row.status === "CANCELLED") {
    return "İptal edilmiş kayıt teslim bordrosuna giremez — bu kâğıt resmen yok sayıldı.";
  }
  if (lockedKind && row.kind !== lockedKind) {
    return `Seçim “${KIND_LABEL[lockedKind]}” çek/senetlerle kilitlendi — bir bordro tek yön taşır. Diğer yön için önce seçimi temizleyin.`;
  }
  return null;
}

/**
 * "Sayfadakilerin tümünü seç" — TEK YÖN kuralına uyar.
 *
 * ⚠️ ATLANAN SATIR SAYISI GERİ DÖNER ve ekranda YAZILIR. Kilitli yön yokken
 * ilk uygun satırın yönü kilit olur; sayfada karışık yön varsa seçim tanım
 * gereği KISMİDİR. "Tümünü seçtim" deyip sessizce yarısını almak, bu projede
 * yazılı olan en kötü toplu-işlem davranışıdır (bkz. kök CLAUDE.md, toplu
 * kurşun dağıtımı: atlanan her satır somut sebebiyle döner).
 */
export function selectAllIds(
  rows: readonly SelectableCheque[],
  lockedKind: ChequeKind | null,
): { ids: string[]; kind: ChequeKind | null; skipped: number } {
  const kind = lockedKind ?? rows.find((r) => r.status !== "CANCELLED")?.kind ?? null;
  if (!kind) return { ids: [], kind: null, skipped: rows.length };
  const ids = rows.filter((r) => selectionBlockReason(r, kind) === null).map((r) => r.id);
  return { ids, kind, skipped: rows.length - ids.length };
}

// -----------------------------------------------------------------------------
// ÜRETİCİ KAPISI (fail-closed)
// -----------------------------------------------------------------------------

/**
 * Bu seçimden bordro ÜRETİLEMİYORSA sebebi; üretilebiliyorsa `null`.
 *
 * Ekran ile üretici AYNI yüklemi çağırır — ayrışırlarsa düğme "yapılabilir"
 * derken üretim patlar (ya da tersi: ekran engeller, üretici sessizce kabul
 * eder ve karışık bir bordro basılır).
 */
export function bordroBlockReason(
  rows: readonly Pick<SelectableCheque, "kind" | "status">[],
): string | null {
  if (rows.length === 0) return BORDRO_EMPTY_ERROR;
  const cancelled = rows.filter((r) => r.status === "CANCELLED").length;
  if (cancelled > 0) {
    return `Seçimde ${cancelled} iptal edilmiş kayıt var — iptal edilen çek/senet teslim bordrosuna giremez.`;
  }
  if (new Set(rows.map((r) => r.kind)).size > 1) return BORDRO_MIXED_KIND_ERROR;
  return null;
}

// -----------------------------------------------------------------------------
// BİÇİMLEME
// -----------------------------------------------------------------------------

/**
 * Tarih hücresi — boş/bozuk değerde BOŞ döner, ekrandaki "—" DEĞİL: "—" Excel'de
 * o kolonu metne çevirir (sıralama bozulur) ve veri varmış gibi görünür.
 * (`chequeExport.dateCell` ile aynı gerekçe; orada dışa açılmadığı için ikizi.)
 */
function dateCell(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR");
}

/** `YYYY-MM-DD` → `GG.AA.YYYY` (parçalardan; `new Date("…")` UTC'ye kaydırır). */
function fmtYmd(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value.trim();
}

const fmtMoney = (n: number): string =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Kuruşa yuvarlanmış toplam — ham `reduce` ikili kayan noktada
 * `16500.499999999996` gibi bir hücre değeri üretir: `numFmt` onu ekranda
 * düzeltir ama ondalık basamağı açan muhasebecinin dosyaya güveni biter.
 */
function sum2(values: number[]): number {
  return Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
}

/** Para birimi bazında adet + toplam — ilk görülme sırasında (deterministik). */
export function totalsByCurrency(
  rows: readonly Pick<ChequeRow, "currency" | "amount">[],
): Array<{ currency: string; count: number; total: number }> {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const bucket = map.get(r.currency) ?? [];
    bucket.push(toNum(r.amount));
    map.set(r.currency, bucket);
  }
  return [...map].map(([currency, values]) => ({
    currency,
    count: values.length,
    total: sum2(values),
  }));
}

// -----------------------------------------------------------------------------
// SPEC
// -----------------------------------------------------------------------------

export interface ChequeBordroInput {
  /** SEÇİLEN satırlar — ekranda görünen listeden gelir, yeni istek atılmaz. */
  rows: ChequeRow[];
  /** Teslim yeri / banka — SERBEST METİN ve OPSİYONEL; boşsa satır basılmaz. */
  place?: string;
  /** Bordro tarihi (`YYYY-MM-DD`, yerel gün) — varsayılanı çağıran verir. */
  dateYmd: string;
}

/**
 * Bordronun tek dışa aktarım spec'i.
 *
 * ⚠️ FAIL-CLOSED: kabul edilemez seçimde `null` DÖNMEZ, FIRLATIR. `null`,
 * `ReportExportBar` için "henüz veri yok" demektir ve karışık bir seçim
 * sessizce hiçbir şey yapmayan bir düğmeye dönüşürdü — sessiz yanlış cevap,
 * gürültülü hatadan kötüdür. Çağıran ekran zaten aynı yüklemi (`bordroBlockReason`)
 * kullanıp düğmeyi kapatır ve sebebi yazar; burası son settir.
 */
export function buildChequeBordro(opts: ChequeBordroInput): ReportExportSpec {
  const { rows, place, dateYmd } = opts;

  const blocked = bordroBlockReason(rows);
  if (blocked) throw new Error(blocked);

  const kind = rows[0]!.kind;
  const buckets = totalsByCurrency(rows);
  const singleCurrency = buckets.length === 1 ? buckets[0]!.currency : null;
  const placeText = place?.trim() ?? "";

  const body = rows.map((c, i) => ({
    // Sıra numarası BELGE İÇİDİR (1…N) ve kalıcı bir kimlik değildir; kâğıt
    // üzerinde "kaçıncı satır" diye konuşulabilsin diye var.
    no: i + 1,
    docNo: c.docNo,
    serialNo: c.serialNo ?? "",
    issueDate: dateCell(c.issueDate),
    dueDate: dateCell(c.dueDate),
    drawer: c.drawerName ?? "",
    bank: c.bankName ?? "",
    currency: c.currency,
    amount: toNum(c.amount),
  }));

  const notes: string[] = [
    `Para birimi bazında toplam — ${buckets
      .map((b) => `${b.currency}: ${b.count} adet · ${fmtMoney(b.total)}`)
      .join(" · ")}`,
  ];
  if (!singleCurrency) {
    notes.push(
      "Listede birden fazla para birimi var → TOPLAM satırında tek tutar YAZILMADI (farklı para birimlerini toplamak anlamsızdır); adet ve para birimi bazlı toplamlar yukarıdadır.",
    );
  }
  notes.push(
    "Teslim Eden — Ad Soyad / İmza: ......................................................",
  );
  notes.push(
    "Teslim Alan — Ad Soyad / İmza: ......................................................",
  );
  notes.push("İki nüsha düzenlenir; bir nüsha teslim alan tarafta kalır.");

  return {
    title: "Çek / Senet Teslim Bordrosu",
    // 9 kolon dikey A4'e sığar; keşideci/banka adları uzun olduğu için yine de
    // yatay basılır — kesilen bir keşideci adı bordroyu tartışmalı hale getirir.
    orientation: "landscape",
    subtitle: `${KIND_LABEL[kind]} çek/senet · ${fmtYmd(dateYmd)}`,
    meta: [
      `Adet: ${rows.length}`,
      ...(placeText ? [`Teslim edilen yer / banka: ${placeText}`] : []),
      kind === "RECEIVED"
        ? "Aşağıdaki çek/senetler portföyümüzden teslim edilmiştir."
        : "Aşağıdaki çek/senetler tarafımızca düzenlenmiş olup teslim edilmiştir.",
      // ⚠️ Bu cümle KAĞIDIN ÜSTÜNDE durmak zorunda: bordronun sistemde kalıcı
      // bir kaydı yok ve kâğıdı elinde tutan kişi, listedeki çeklerin durumunun
      // bordro basıldıktan sonra değişmiş olabileceğini bilmeli.
      "Bu bordro, düzenlendiği andaki seçimi yansıtan ANLIK bir çıktıdır: sisteme kaydedilen bir belge numarası ya da sürümü yoktur; çeklerin durumu sonradan değişebilir.",
    ],
    tables: [
      {
        name: "Teslim Edilen Çek / Senetler",
        columns: COLUMNS,
        rows: body,
        totalRow: {
          no: "",
          docNo: `TOPLAM (${rows.length} adet)`,
          serialNo: "",
          issueDate: "",
          dueDate: "",
          drawer: "",
          bank: "",
          currency: singleCurrency ?? "",
          // Karışık para biriminde hücre BOŞ — anlamsız bir toplam basmaktansa
          // sayı hiç yazılmaz; kırılımı yukarıdaki not taşır.
          amount: singleCurrency ? sum2(rows.map((r) => toNum(r.amount))) : "",
        },
        notes,
      },
    ],
  };
}
