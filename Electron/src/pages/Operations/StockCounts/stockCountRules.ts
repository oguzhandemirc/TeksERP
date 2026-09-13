// =============================================================================
// TAM STOK SAYIMI — SAF KATMAN (durum · okutma · fark kapsamı · süzgeç)
// =============================================================================
// Ekranın "sessizce yanlış" olabilecek kararları burada yaşar ve
// `stockCountRules.test.ts` tarafından kilitlenir. Bir `if`i bileşenin içinde
// bırakmak, tersine çevrilmesinin hiçbir testi kırmaması demektir (mobil
// `shouldReleaseInFlight` dersi; bu ekranda bedeli TOPLARIN KAYITTAN DÜŞMESİ).
//
// ⚠️ BU EKRAN YIKICI BİR İŞLEMİN ÖNÜNDEDİR. "Tamamla" tuşu geri alınamaz bir
// fark fişi yazar: eksik işaretlenmiş her top `CANCELLED` olur, iplik farkı
// deftere ADJUST olarak işler ve belge donar. Bu yüzden buradaki fonksiyonların
// tek işi, o tuşa basılmadan ÖNCE "tam olarak ne olacak" sorusunu SOMUT
// kayıtlarla cevaplayabilmektir — kök kural: "N kayıt etkilenecek" YETMEZ.
//
// ⚠️ İSTEMCİ SEDDİ BACKEND'İN YERİNE GEÇMEZ, ONU ÖNCEDEN SÖYLER. Buradaki her
// engel cümlesinin arkasında gerçek bir 400/409 vardır (üst sınır, taslak-dışı
// sayım); amaç kullanıcıya sonradan reddedilecek bir işlem yaptırmamaktır.
// =============================================================================
import { dayEndIso, dayStartIso } from "@/pages/Finance/Cheques/dates";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import type { DecimalLike, StockCountLine, StockCountStatus } from "./service";
import { lowerTr, upperTr } from "../../../lib/tr-case";

// -----------------------------------------------------------------------------
// SAYI
// -----------------------------------------------------------------------------

/** Decimal (string|number|null) → number. Okunamayan değer 0 sayılır. */
export function num(v: DecimalLike | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
}

/** Ekrana giden miktar — TR biçim, en fazla 2 hane. */
export function qty(v: DecimalLike | null | undefined): string {
  if (v == null) return "—";
  return num(v).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

/** Ondalık hane sayısı — `subtractQty` ölçeğini kurar. */
function decimals(v: DecimalLike): number {
  const s = String(v).trim();
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * `a − b`, KAYAN NOKTA ARTEFAKTI ÜRETMEDEN.
 *
 * ⚠️ Düz `num(a) - num(b)` yazılsaydı `0.3 − 0.1` **0.19999999999999998** verir
 * ve iki şey birden bozulurdu: (1) "fark yok" satırı ekranda `0,00` yerine
 * mikroskobik bir sayı gösterir, (2) daha kötüsü, `diff !== 0` kontrolü TUTAR ve
 * onay diyaloğu gerçekte uygulanmayacak bir düzeltmeyi "uygulanacak" diye
 * listeler. Backend Decimal ile TAM hesaplıyor; ekranın onunla aynı cevabı
 * vermesi, kâğıt ile onayın aynı şeyi söylemesi demek.
 *
 * Ölçek iki değerin hane sayısının maksimumudur (kg/metre büyüklüklerinde
 * tamsayıya çevirme güvenli).
 */
export function subtractQty(a: DecimalLike, b: DecimalLike): number {
  return scaledOp(a, b, (x, y) => x - y);
}

/**
 * `a + b`, aynı ölçekleme ile. TOPLAM da artefakt üretebilir: onay ekranındaki
 * "kaç metre kayıttan düşecek" rakamı düz `+=` ile toplanırsa 0,1'lik satırlarda
 * `12.299999999999999` basar — yıkıcı bir onayda bozuk görünen bir sayı, doğru
 * olsa bile güveni düşürür.
 */
export function addQty(a: DecimalLike, b: DecimalLike): number {
  return scaledOp(a, b, (x, y) => x + y);
}

/** İki değeri ORTAK ölçeğe çekip tamsayı aritmetiğiyle işler. */
function scaledOp(a: DecimalLike, b: DecimalLike, op: (x: number, y: number) => number): number {
  const scale = Math.max(decimals(a), decimals(b));
  const f = 10 ** scale;
  return op(Math.round(num(a) * f), Math.round(num(b) * f)) / f;
}

// -----------------------------------------------------------------------------
// ETİKETLER
// -----------------------------------------------------------------------------

export const STATUS_LABEL: Record<StockCountStatus, string> = {
  DRAFT: "Taslak",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
};

/** Rozet tonu — renk TEK BAŞINA erişilebilir değildir, etiket her zaman basılır. */
export const STATUS_BADGE: Record<StockCountStatus, "default" | "secondary" | "outline"> = {
  DRAFT: "secondary",
  COMPLETED: "default",
  CANCELLED: "outline",
};

export type RollLineState = "OUT_OF_SCOPE" | "MISSING" | "FOUND" | "UNCOUNTED";
export type YarnLineState = "OUT_OF_SCOPE" | "APPLIED" | "MATCH" | "UNCOUNTED";

/**
 * ROLL satırının durumu.
 *
 * ⚠️ SIRA BACKEND BUILDER'IYLA BİREBİR: "kapsam dışı" EN ÖNCE sorulur. O satır
 * `found = false` TAŞIR (eksik işaretlendi) ama İŞLENMEMİŞTİR; sıra ters
 * olsaydı ekran onu "kayıttan düşüldü" diye gösterir ve donmuş belgeyle
 * ÇELİŞİRDİ (`warehouse-doc.html.ts` aynı sırayı uyguluyor).
 */
export function rollLineState(line: Pick<StockCountLine, "found" | "outOfScopeReason">): RollLineState {
  if (line.outOfScopeReason) return "OUT_OF_SCOPE";
  if (line.found === false) return "MISSING";
  if (line.found === true) return "FOUND";
  return "UNCOUNTED";
}

/** YARN satırının durumu — aynı sıra kuralı (kapsam dışı önce). */
export function yarnLineState(
  line: Pick<StockCountLine, "countedQty" | "expectedQty" | "outOfScopeReason">,
): YarnLineState {
  if (line.outOfScopeReason) return "OUT_OF_SCOPE";
  if (line.countedQty == null) return "UNCOUNTED";
  return subtractQty(line.countedQty, line.expectedQty) === 0 ? "MATCH" : "APPLIED";
}

/**
 * Durum etiketi — ZAMAN KİPİ SAYIMIN DURUMUNDAN gelir.
 *
 * ⚠️ Donmuş belge "EKSİK — KAYITTAN DÜŞÜLDÜ" basar ve orada DOĞRUDUR (fark fişi
 * yazıldı). TASLAK ekranda aynı cümle YALANDIR: henüz hiçbir şey olmadı, kullanıcı
 * işareti geri alabilir. Kipi tek bir sözlükte sabitlemek, "ekranda düşüldü
 * yazıyordu ama top duruyordu" sınıfı bir güven kaybını imkânsız kılar.
 */
export function rollStateLabel(state: RollLineState, status: StockCountStatus): string {
  const applied = status === "COMPLETED";
  switch (state) {
    case "FOUND":
      return "Bulundu";
    case "MISSING":
      return applied ? "Eksik — kayıttan düşüldü" : "Eksik — kayıttan düşülecek";
    case "OUT_OF_SCOPE":
      return "Kapsam dışı";
    case "UNCOUNTED":
      return "Sayılmadı";
  }
}

export function yarnStateLabel(state: YarnLineState, status: StockCountStatus): string {
  const applied = status === "COMPLETED";
  switch (state) {
    case "APPLIED":
      return applied ? "Fark uygulandı" : "Fark uygulanacak";
    case "MATCH":
      return "Tuttu";
    case "OUT_OF_SCOPE":
      return "Kapsam dışı";
    case "UNCOUNTED":
      return "Sayılmadı";
  }
}

/** Satırın insan-okunur adı — onay diyaloğu ve tablo aynı metni kullanır. */
export function lineLabel(line: StockCountLine): string {
  if (line.kind === "YARN") {
    return line.item?.name ?? "—";
  }
  const item = line.roll?.item?.name ?? "—";
  const color = line.roll?.color?.name;
  return color ? `${item} · ${color}` : item;
}

// -----------------------------------------------------------------------------
// KAPSAM DIŞI ÖNGÖRÜSÜ
// -----------------------------------------------------------------------------

/**
 * SAYILABİLİR STATÜLER — backend `COUNTABLE_ROLL_STATUSES` aynası.
 *
 * ⚠️ Electron backend'i import EDEMEZ (ayrı proje); liste elle aynalanır.
 * Ayrışmanın iki yönü de sessizdir: burada eksik bir statü "bu top işlenmeyecek"
 * diye YANLIŞ uyarı üretir, fazla bir statü ise gerçekten atlanacak satırı
 * onayda GİZLER. İkisi de kullanıcıyı yanlış bilgiyle onaya sokar.
 */
export const COUNTABLE_ROLL_STATUSES = ["STOCK", "WAREHOUSE", "A1_STOCK"] as const;

/**
 * Bu top, tamamlamada ATLANACAK gibi mi görünüyor? Engel varsa SOMUT sebep,
 * yoksa `null`.
 *
 * ⚠️ ÖNGÖRÜDÜR, KESİN LİSTE DEĞİL — ve bu bilinçli. Detay ucu topun yalnız
 * CANLI STATÜSÜNÜ döndürüyor; backend ayrıca depo/çuval/sevkiyat/iş emri bağını
 * da kontrol ediyor (`blockReason`). Yani buradan `null` dönmesi "kesin
 * işlenecek" GARANTİSİ vermez. Diyalog bunu cümleyle söyler; "kesin" diye sunmak
 * yıkıcı bir onayda uydurulmuş bir kesinlik olurdu.
 *
 * ⚠️ Yalnız EKSİK işaretli satırlar için sorulur: bulundu/sayılmadı satırlarına
 * tamamlamada zaten dokunulmuyor, onlar için "kapsam dışı" uyarısı basmak
 * kullanıcıyı olmayan bir sorunu araştırmaya gönderirdi.
 */
export function predictedOutOfScope(line: StockCountLine): string | null {
  const status = line.roll?.status;
  if (!status) return null;
  if (status === "SHIPPED") return "Bu sırada sevk edilmiş";
  if (status === "CANCELLED" || status === "SCRAP") return "Zaten kayıttan düşülmüş";
  if (!(COUNTABLE_ROLL_STATUSES as readonly string[]).includes(status)) {
    // ⚠️ BACKEND İKİZİYLE AYNI ANDA DÜZELTİLDİ (`stock-count.service.blockReason`
    // → `ROLL_STATUS_TR`). Biri Türkçeleşip diğeri kalsaydı aynı satır ekranda
    // "Fasonda", TUTANAKTA "AT_SUBCONTRACTOR" yazardı ve "önizleme = gerçek
    // belge" sözleşmesi, üstelik geriye dönük düzeltilemeyen bir kâğıtta bozulurdu.
    // Sözlükler metin metin aynıdır (bekçi: Teks-Erp/scripts/test_status_labels.ts).
    return `Statüsü değişmiş (${rollStatusLabels[status as RollStatus] ?? status})`;
  }
  return null;
}

// -----------------------------------------------------------------------------
// OKUTMA
// -----------------------------------------------------------------------------

export type ScanResult =
  /** Listede, henüz işaretsiz → "bulundu" yapılacak. */
  | { kind: "found"; line: StockCountLine }
  /** Listede ve ZATEN bulundu → yeniden yazmaya gerek yok. */
  | { kind: "already"; line: StockCountLine }
  /** Eksik işaretliydi; okutuldu → işaret GERİ ALINIR (top rafta çıktı). */
  | { kind: "revived"; line: StockCountLine }
  /** Boş/anlamsız girdi. */
  | { kind: "empty" }
  /** Sayım listesinde YOK — fazla/yabancı top. */
  | { kind: "unknown"; code: string };

/** Barkod karşılaştırması — kenar boşlukları ve harf büyüklüğü ELENİR. */
function normalizeCode(v: string | null | undefined): string {
  return (v ?? "").trim().toUpperCase();
}

/**
 * Okutulan kodu sayım listesinde arar.
 *
 * ⚠️ "FAZLA TOP" SESSİZCE EKLENMEZ (`unknown`). Sayım, defteri fiziksel gerçeğe
 * göre KISALTIR; genişletmez. Listede olmayan bir barkod başka depoda, üretimde
 * ya da sevk edilmiş olabilir ve doğru cevabı yalnız insan bilir (transfer? mal
 * kabul? yanlış rafa konmuş?). Sessiz oto-ekleme gerçek hatayı örter — plan
 * kararı: "fazla/yabancı top OTOMATİK DÜZELTİLMEZ, uyarı satırı".
 *
 * ⚠️ BARKODSUZ satır (açık kumaş) kodla BULUNAMAZ ve bu doğrudur: eşleştirilecek
 * bir kod yoktur. `normalizeCode(null)` boş string döner; boş kod aramasının
 * `empty` dalında elenmesi bu yüzden LOAD-BEARING — elenmeseydi boş bir okutma
 * barkodsuz İLK satırı eşleştirip rastgele bir topu "bulundu" yapardı.
 */
export function scanMatch(lines: readonly StockCountLine[], rawCode: string): ScanResult {
  const code = normalizeCode(rawCode);
  if (!code) return { kind: "empty" };

  const line = lines.find(
    (l) => l.kind === "ROLL" && normalizeCode(l.roll?.barcode) === code,
  );
  if (!line) return { kind: "unknown", code };
  if (line.found === true) return { kind: "already", line };
  if (line.found === false) return { kind: "revived", line };
  return { kind: "found", line };
}

// -----------------------------------------------------------------------------
// SAYIM İLERLEYİŞİ
// -----------------------------------------------------------------------------

export interface CountProgress {
  rollTotal: number;
  rollFound: number;
  rollMissing: number;
  rollUncounted: number;
  yarnTotal: number;
  yarnCounted: number;
  yarnUncounted: number;
}

export function countProgress(lines: readonly StockCountLine[]): CountProgress {
  const p: CountProgress = {
    rollTotal: 0, rollFound: 0, rollMissing: 0, rollUncounted: 0,
    yarnTotal: 0, yarnCounted: 0, yarnUncounted: 0,
  };
  for (const l of lines) {
    if (l.kind === "ROLL") {
      p.rollTotal++;
      if (l.found === true) p.rollFound++;
      else if (l.found === false) p.rollMissing++;
      else p.rollUncounted++;
    } else {
      p.yarnTotal++;
      if (l.countedQty == null) p.yarnUncounted++;
      else p.yarnCounted++;
    }
  }
  return p;
}

// -----------------------------------------------------------------------------
// SATIR SÜZGECİ (sayım kâğıdı içi)
// -----------------------------------------------------------------------------

export interface RollViewFilter {
  /** "Sayılmayanları göster" — kalan işi bulmanın tek pratik yolu. */
  onlyUncounted: boolean;
  search: string;
}

export const EMPTY_ROLL_VIEW: RollViewFilter = { onlyUncounted: false, search: "" };

/**
 * Sayım kâğıdındaki top satırlarını süzer.
 *
 * ⚠️ BU SÜZGEÇ İSTEMCİDEDİR ve olması gereken de budur: sayımın satırları TEK
 * SEFERDE geliyor (detay ucu sayfalamıyor), yani "sonraki sayfada olabilir"
 * riski YOK. Liste sayfalı olsaydı istemcide süzmek yasaktı — o kural
 * (`YarnStockPage` başlığı) sunucu sayfalaması içindir; buradaki kapsam farkı
 * bilerek yazılıyor ki biri gelip "kural ihlali" diye sunucuya taşımasın.
 *
 * ⚠️ Arama BARKOD **ve** ÜRÜN/RENK üzerinde çalışır: barkodsuz açık kumaş
 * satırları yalnız barkodla aranırsa HİÇ bulunamaz ve operatör "listede yok"
 * sanıp fiziksel malı eksik işaretler.
 */
export function filterRollLines(
  lines: readonly StockCountLine[],
  f: RollViewFilter,
): StockCountLine[] {
  const needle = upperTr(f.search.trim());
  return lines.filter((l) => {
    if (l.kind !== "ROLL") return false;
    if (f.onlyUncounted && l.found !== null) return false;
    if (!needle) return true;
    const hay = upperTr(`${l.roll?.barcode ?? ""} ${lineLabel(l)}`);
    return hay.includes(needle);
  });
}

// -----------------------------------------------------------------------------
// FARK KAPSAMI (yıkıcı işlem onayı)
// -----------------------------------------------------------------------------

/**
 * Tek fark fişinde kayıttan düşülebilecek EN FAZLA top — backend
 * `STOCK_COUNT_MAX_MISSING` aynası. Aşılırsa backend 400 veriyor; ekran aynı
 * cümleyi GÖNDERMEDEN söyler (kullanıcı 250 satır işaretleyip reddedilmesin).
 *
 * ⚠️ AYNA OLMAK, AYNI KÜMEYİ SAYMAK DEMEKTİR — yalnız sayı aynı olsun yetmez.
 * Sınırın uygulandığı yer `completeBlockReason`; oradaki nota bak.
 */
export const MAX_MISSING = 200;

export interface MissingRollEntry {
  lineId: string;
  rollId: string | null;
  barcode: string | null;
  label: string;
  /**
   * FOTOĞRAF metrajı — onay ekranındaki ÖNGÖRÜ.
   *
   * ⚠️ Kesin rakam DEĞİL: fark fişi tamamlama anındaki (tx içinde pinlenmiş)
   * canlı metrajı yazar. Arada `adjust-qty` ile metraj düzeltilirse defterlere
   * ve donmuş tutanağa o değer girer; ekran o anı bilemez (detay ucu topun
   * canlı metrajını taşımıyor). Sayım metraja KENDİSİ dokunmaz.
   */
  qty: number;
}

export interface YarnDiffEntry {
  lineId: string;
  itemName: string;
  itemCode: string | null;
  expectedKg: number;
  countedKg: number;
  /** + fazla çıktı (ADJUST_IN) · − eksik çıktı (ADJUST_OUT). */
  diffKg: number;
}

export interface OutOfScopeEntry {
  lineId: string;
  barcode: string | null;
  label: string;
  qty: number;
  reason: string;
}

export interface CompletionScope {
  /** İPTAL EDİLECEK toplar — onayda tek tek basılır. */
  missing: MissingRollEntry[];
  missingMeters: number;
  /** Deftere yazılacak iplik düzeltmeleri. */
  yarnDiffs: YarnDiffEntry[];
  /** Eksik işaretli ama muhtemelen ATLANACAK satırlar (öngörü). */
  outOfScope: OutOfScopeEntry[];
  /** Hiç işaretlenmemiş — tamamlamada DOKUNULMAZ. */
  uncountedRolls: number;
  uncountedYarn: number;
  foundRolls: number;
  /** Sayan kişi tek bir satıra bile dokundu mu? */
  touched: boolean;
}

/**
 * "Tamamla"ya basılırsa NE OLACAK — somut kayıt listeleriyle.
 *
 * ⚠️ EKSİK = YALNIZ AÇIKÇA `found === false`. `null` (sayılmadı) EKSİK SAYILMAZ
 * ve bu backend'in kuralının aynasıdır: yarım bırakılmış bir sayımın
 * tamamlanması, sayılmamış her topu sessizce kayıttan düşerdi. Onay ekranı bu
 * ayrımı SAYIYLA gösterir (`uncountedRolls`), yoksa kullanıcı "listede 300 top
 * var, 12'sini işaretledim" derken 288'inin ne olacağını bilemez.
 *
 * ⚠️ KAPSAM DIŞI ADAYLARI `missing`TEN DÜŞÜLÜR. Aynı satırı iki listede birden
 * saymak, onay ekranındaki metrajı ŞİŞİRİR — ve şişen taraf tam da "kaç metre
 * kayıttan düşecek" sorusunun cevabıdır.
 */
export function completionScope(lines: readonly StockCountLine[]): CompletionScope {
  const scope: CompletionScope = {
    missing: [], missingMeters: 0, yarnDiffs: [], outOfScope: [],
    uncountedRolls: 0, uncountedYarn: 0, foundRolls: 0, touched: false,
  };

  for (const l of lines) {
    if (l.found !== null || l.countedQty != null) scope.touched = true;

    if (l.kind === "ROLL") {
      if (l.found === true) {
        scope.foundRolls++;
        continue;
      }
      if (l.found !== false) {
        scope.uncountedRolls++;
        continue;
      }
      const label = lineLabel(l);
      const q = num(l.expectedQty);
      const blocked = predictedOutOfScope(l);
      if (blocked) {
        scope.outOfScope.push({
          lineId: l.id, barcode: l.roll?.barcode ?? null, label, qty: q, reason: blocked,
        });
        continue;
      }
      scope.missing.push({
        lineId: l.id, rollId: l.roll?.id ?? null, barcode: l.roll?.barcode ?? null, label, qty: q,
      });
      scope.missingMeters = addQty(scope.missingMeters, q);
      continue;
    }

    if (l.countedQty == null) {
      scope.uncountedYarn++;
      continue;
    }
    const diff = subtractQty(l.countedQty, l.expectedQty);
    if (diff === 0) continue;
    scope.yarnDiffs.push({
      lineId: l.id,
      itemName: l.item?.name ?? "—",
      itemCode: l.item?.code ?? null,
      expectedKg: num(l.expectedQty),
      countedKg: num(l.countedQty),
      diffKg: diff,
    });
  }

  return scope;
}

/**
 * "Tamamla" engeli — engel varsa SEBEP, yoksa `null`.
 *
 * ⚠️ HİÇ DOKUNULMAMIŞ SAYIM TAMAMLANAMAZ ve bu kural BACKEND'DE YOKTUR (orada
 * meşru bir istektir: boş depo da tamamlanabilmeli). Ekranda engellenmesinin
 * sebebi işlemin TERMİNAL olmasıdır: kazara basılan tuş sayımı kapatır, resmi
 * belgeyi dondurur ve depo yeni bir sayım açmak zorunda kalır. Satırı olmayan
 * (gerçekten boş) depoda kural DEVREYE GİRMEZ — orada işaretlenecek bir şey yok.
 */
export function completeBlockReason(
  status: StockCountStatus,
  scope: CompletionScope,
  lineCount: number,
): string | null {
  if (status !== "DRAFT") {
    return `Bu sayım ${lowerTr(STATUS_LABEL[status])} — yeniden tamamlanamaz.`;
  }
  // ⚠️ SINIR, BACKEND'İN SAYDIĞI KÜME ÜZERİNDEN ÖLÇÜLÜR: `found === false`
  // işaretli TÜM top satırları (`stock-count.service`: `missing = lines.filter(
  // ROLL && found === false && rollId)`). Yalnız `scope.missing`e bakmak, kapsam
  // dışı ADAYLARINI (`predictedOutOfScope`) düşerdi ve "göndermeden söyle"
  // vaadi tam da o satırlar varken çökerdi: 210 eksik işaretin 15'i bu arada
  // sevk edilmişse ekran 195 ≤ 200 görüp düğmeyi AÇAR, backend 210 sayıp 400
  // döner. Etiket/metin yine `missing`i gösterir (kullanıcı için anlamlı olan
  // "kaç top düşecek" sayısıdır), ölçülen sınır bu değildir.
  const markedMissing = scope.missing.length + scope.outOfScope.length;
  if (markedMissing > MAX_MISSING) {
    return (
      `${markedMissing} top eksik işaretlenmiş (sınır ${MAX_MISSING}). ` +
      "Bu kadar büyük bir fark tek fişle kapatılmaz — önce nedenini araştırın ya da sayımı bölün."
    );
  }
  if (!scope.touched && lineCount > 0) {
    return (
      "Hiçbir satır işaretlenmedi. Tamamlamak sayımı KAPATIR ve tutanağı dondurur; " +
      "önce sayımı girin (ya da hepsi yerindeyse “Hepsi Bulundu”ya basın)."
    );
  }
  return null;
}

/**
 * Onay düğmesinin ÜZERİNDEKİ metin — yaptığı işin adını taşır.
 *
 * ⚠️ "Onayla" YAZMAZ. Bu tuş toplara `CANCELLED` yazan ve iplik defterine
 * işleyen TERMİNAL bir işlemdir; jenerik bir etiket, iki farklı sonucu (fark
 * var / fark yok) aynı görünürde birleştirir. Projenin yazılı kuralı: tuş
 * yaptığı işin adını taşır (2026-08-12 Tambur geri alma metin seti).
 */
export function completeButtonLabel(scope: CompletionScope): string {
  const parts: string[] = [];
  if (scope.missing.length > 0) parts.push(`${scope.missing.length} topu düş`);
  if (scope.yarnDiffs.length > 0) parts.push(`${scope.yarnDiffs.length} iplik farkını yaz`);
  return parts.length === 0 ? "Farksız tamamla" : `${parts.join(" · ")} ve tamamla`;
}

/** Taslak sayım iptal edilebilir mi — engel varsa sebep. */
export function cancelBlockReason(status: StockCountStatus): string | null {
  if (status === "COMPLETED") {
    return (
      "Tamamlanmış sayım iptal edilemez: fark fişi iki deftere işledi. " +
      "Farkı geri almak için sayımı stornolayın."
    );
  }
  if (status === "CANCELLED") return "Bu sayım zaten iptal edilmiş.";
  return null;
}

// -----------------------------------------------------------------------------
// SAYILAN MİKTAR GİRDİSİ (iplik)
// -----------------------------------------------------------------------------

/** Binlik grubu GÖRÜNÜMÜ: `1.250` — noktadan sonra tam üç hane ve devamı yok. */
const THOUSANDS_LOOKING = /\d[.]\d{3}(?!\d)/;

/**
 * Kullanıcı metni → sayılan miktar. Virgül ONDALIKTIR (TR klavye).
 *
 * ⚠️ BELİRSİZ GİRDİ TAHMİN EDİLMEZ, REDDEDİLİR (`cashTxnRules.parseAmount` ile
 * aynı gerekçe): `"1.250"` hem TR binlik ayracıyla **1250** hem nokta
 * ondalığıyla **1,25** olabilir; düz `Number()` ikincisini seçer ve 1250 kg'lık
 * bir sayım **1,25 kg** olarak deftere geçerdi — bin kat yanlış, hata yok, log yok.
 *
 * PARA ALANINDAN İKİ BİLİNÇLİ FARK:
 *   • **0 GEÇERLİDİR.** "Saydım, hiç kalmamış" sayımın en sık ve en önemli
 *     cevabıdır; sıfırı reddetmek, defteri sıfırlamanın tek yolunu kapatırdı.
 *   • **NEGATİF REDDEDİLİR.** Sayılan miktar fiziksel bir ölçümdür; eksi
 *     bakiye DEFTERİN durumudur, sayımın sonucu değil.
 *
 * ⚠️ `wire` kullanıcının yazdığı metnin NORMALİZE hâlidir, kayan noktadan
 * geçirilmiş hâli değil: backend `number | string` kabul edip Decimal'e çevirir.
 */
export function parseCountedQty(text: string): { value: number; wire: string } | null {
  const raw = text.trim().replace(/\s/g, "");
  if (raw === "") return null;
  if ((raw.match(/[.,]/g)?.length ?? 0) > 1) return null;
  if (THOUSANDS_LOOKING.test(raw)) return null;
  const normalized = raw.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return { value, wire: normalized };
}

/**
 * Girdi kutusunun altındaki cümle. `null` = basma.
 *
 * ⚠️ REDDEDİLEN HER GİRDİYE "0 veya daha büyük bir sayı girin" DEMEK YANLIŞTIR:
 * `1.250,00` zaten öyledir ve kullanıcı olmayan bir sorunu aramaya başlar.
 * Reddin gerçek sebebi biçimdir; cümle onu ve çözümü söyler.
 */
export function countedQtyHint(text: string): string | null {
  const raw = text.trim();
  if (raw === "" || parseCountedQty(raw)) return null;
  if ((raw.replace(/\s/g, "").match(/[.,]/g)?.length ?? 0) > 1 || THOUSANDS_LOOKING.test(raw)) {
    return "Binlik ayracı kullanmayın — “1.250,00” yerine “1250,5” yazın (virgül ondalıktır).";
  }
  return "Sayılan miktar 0 veya daha büyük bir sayı olmalı.";
}

// -----------------------------------------------------------------------------
// SÜZGEÇ → SORGU
// -----------------------------------------------------------------------------

export interface StockCountFilterState {
  warehouseId: string;
  /** "" = tümü. Backend TEK değer alır (CSV değil). */
  status: string;
  /** `<input type="date">` — "" meşrudur (kullanıcı temizleyebilir). */
  from: string;
  to: string;
  search: string;
}

export const EMPTY_STOCK_COUNT_FILTERS: StockCountFilterState = {
  warehouseId: "",
  status: "",
  from: "",
  to: "",
  search: "",
};

export function isStockCountFilterDirty(f: StockCountFilterState): boolean {
  return Boolean(f.warehouseId || f.status || f.from || f.to || f.search);
}

/**
 * Süzgeç durumu → HTTP parametreleri.
 *
 * ⚠️ ÜÇ SÖZLEŞME, üçü de bekçide:
 *   1. BOŞ DEĞER HİÇ GÖNDERİLMEZ (`undefined`) — boş parametre hem sunucunun iç
 *      `if`ine bel bağlamak hem react-query anahtarını kirletmek demektir.
 *   2. GÜN SINIRI İSTEMCİNİNDİR: yerel 00:00 / 23:59:59.999 (`Cheques/dates` TEK
 *      KAYNAK). Backend mutlak an alır ve ekstra yuvarlama YAPMAZ; burada
 *      `new Date("YYYY-MM-DD")` yazmak değeri UTC gece yarısı sayıp TR'de günü
 *      bir kaydırırdı.
 *   3. Bozuk/boş tarih `undefined` döner — sessizce "bir tarihe" çevrilmez.
 */
export function buildListQuery(f: StockCountFilterState): {
  warehouseId?: string;
  status?: StockCountStatus;
  from?: string;
  to?: string;
  search?: string;
} {
  return {
    warehouseId: f.warehouseId || undefined,
    status: (f.status || undefined) as StockCountStatus | undefined,
    from: dayStartIso(f.from),
    to: dayEndIso(f.to),
    search: f.search.trim() || undefined,
  };
}

/**
 * Liste BOŞ dönünce ne yazacağımız.
 *
 * ⚠️ "HİÇ SAYIM YOK" CÜMLESİ YALNIZ SÜZGEÇSİZ SORGUDA KURULABİLİR. Daraltılmış
 * bir listede o cümle YALANDIR ve kullanıcıyı ikinci bir sayım açmaya iter —
 * oysa aynı depoda açık sayım varsa backend 409 verir ve kullanıcı sebebini
 * anlamaz. (Emsal: `yarnEmptyStateMessage`.)
 */
export function stockCountEmptyMessage(f: StockCountFilterState): string {
  return isStockCountFilterDirty(f)
    ? "Bu filtreyle sayım yok. Filtreleri temizleyip tekrar bakın."
    : "Henüz stok sayımı yapılmamış. “Yeni Sayım” ile bir depo seçip başlayın — sayım açmak hiçbir deftere yazmaz.";
}
