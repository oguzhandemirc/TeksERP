// =============================================================================
// KASA HAREKETLERİ — SAF KATMAN (etiketler · süzgeç · engel yüklemleri · kapsam)
// =============================================================================
// Ekranın "sessizce yanlış" olabilecek kararları burada yaşar ve `cashTxnRules
// .test.ts` tarafından kilitlenir. Bir `if`i bileşenin içinde bırakmak, tersine
// çevrilmesinin hiçbir testi kırmaması demektir (mobil `shouldReleaseInFlight`
// dersi).
//
// ⚠️ İSTEMCİ SEDDİ BACKEND'İN YERİNE GEÇMEZ, ONU ÖNCEDEN SÖYLER. Buradaki her
// engel cümlesinin arkasında gerçek bir 400/409 vardır; amaç kullanıcıya
// sonradan reddedilecek bir kombinasyon kurdurmamaktır (`PaymentFormDialog`ın
// "para birimi hesaptan gelir" kararının aynası). Bir kural buradan düşerse
// veri bozulmaz — kullanıcı ham hata yer.
// =============================================================================

import { cashAccountParams, type CashAccountKind } from "../PeriodClose/cashService";
import { dayEndIso, dayStartIso } from "../Cheques/dates";
import type { CashTxnDirection, CashTxnKind, CashTxnRow, CashTxnStatus } from "./service";
import type { Currency } from "../service";

// -----------------------------------------------------------------------------
// ETİKETLER
// -----------------------------------------------------------------------------

export const KIND_LABEL: Record<CashTxnKind, string> = {
  EXPENSE: "Masraf",
  INCOME: "Gelir",
  OPENING: "Açılış",
  TRANSFER_OUT: "Virman (çıkan)",
  TRANSFER_IN: "Virman (giren)",
};

export const STATUS_LABEL: Record<CashTxnStatus, string> = {
  ACTIVE: "Aktif",
  CANCELLED: "İptal",
};

/** ELLE fiş girilebilen üç tür — virman kendi ucundan (iki bacak) doğar. */
export const ENTRY_KINDS = ["EXPENSE", "INCOME", "OPENING"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * Backend `KIND_DIRECTION` aynası — YALNIZ FORM ÖNİZLEMESİ İÇİN ("bakiye
 * artacak/azalacak"). Liste satırında yön ASLA türden türetilmez, `row.direction`
 * okunur: sunucu tek kaynaktır ve DB CHECK'i onu tutar; ikinci bir türetme,
 * enum genişlediği gün ekranı sessizce yanlışlar.
 */
export const ENTRY_KIND_DIRECTION: Record<EntryKind, CashTxnDirection> = {
  EXPENSE: "OUT",
  INCOME: "IN",
  OPENING: "IN",
};

/** Renk tek başına erişilebilir değildir — işaret (+/−) her zaman basılır. */
export const DIRECTION_TONE: Record<CashTxnDirection, string> = {
  IN: "text-emerald-600 dark:text-emerald-400",
  OUT: "text-amber-700 dark:text-amber-500",
};

/** `+1.234,50 ₺` / `−1.234,50 ₺` — biçimlenmiş tutarın önüne yön işareti. */
export function withSign(direction: CashTxnDirection, formatted: string): string {
  return `${direction === "IN" ? "+" : "−"}${formatted}`;
}

/** Satırın hesabı — XOR gereği ikisinden tam biri doludur. */
export function accountNameOf(row: Pick<CashTxnRow, "cashBox" | "bankAccount">): string {
  return row.cashBox?.name ?? row.bankAccount?.name ?? "—";
}

// -----------------------------------------------------------------------------
// SÜZGEÇ → SORGU
// -----------------------------------------------------------------------------

export interface CashTxnFilterState {
  account: { kind: CashAccountKind; id: string } | null;
  /** "" = tümü. Backend TEK değer alır (CSV değil). */
  kind: string;
  status: string;
  search: string;
  /** `<input type="date">` — "" meşrudur (kullanıcı temizleyebilir). */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: CashTxnFilterState = {
  account: null,
  kind: "",
  status: "",
  search: "",
  from: "",
  to: "",
};

export function isFilterDirty(f: CashTxnFilterState): boolean {
  return Boolean(f.account || f.kind || f.status || f.search || f.from || f.to);
}

/**
 * Süzgeç durumu → HTTP parametreleri.
 *
 * ⚠️ ÜÇ SÖZLEŞME, üçü de bekçide:
 *   1. BOŞ DEĞER HİÇ GÖNDERİLMEZ (`undefined`). `kind=""` göndermek bugün
 *      zararsız (backend falsy'yi eler) ama sözleşme sunucunun iç `if`ine
 *      dayanamaz; ayrıca boş parametre react-query anahtarını da kirletir.
 *   2. GÜN SINIRI İSTEMCİNİNDİR: yerel 00:00 / 23:59:59.999 (`Cheques/dates`
 *      tek kaynak). Boş/bozuk tarih `undefined` döner — sessizce bir güne
 *      çevirmek (eski hâli **1 Ocak 1900** üretiyordu) listeyi boşaltırdı.
 *   3. HESAP XOR `cashAccountParams`tan geçer, ELLE kurulmaz: iki anahtarı
 *      birden göndermek backend'de 400'dür ve kullanıcı hiç liste alamaz.
 */
export function buildListQuery(f: CashTxnFilterState): Record<string, string | undefined> {
  return {
    ...(f.account ? cashAccountParams(f.account.kind, f.account.id) : {}),
    kind: f.kind || undefined,
    status: f.status || undefined,
    search: f.search.trim() || undefined,
    from: dayStartIso(f.from),
    to: dayEndIso(f.to),
  };
}

// -----------------------------------------------------------------------------
// TUTAR
// -----------------------------------------------------------------------------

/** Binlik grubu GÖRÜNÜMÜ: `1.250` — noktadan sonra tam üç hane ve devamı yok. */
const THOUSANDS_LOOKING = /\d[.]\d{3}(?!\d)/;

/**
 * Kullanıcı metni → tutar. Virgül ONDALIKTIR (TR klavye); geçersiz değerde
 * `null` döner ve çağıran "kaydet"i kapatır.
 *
 * ⚠️⚠️ BELİRSİZ GİRDİ TAHMİN EDİLMEZ, REDDEDİLİR — bu fonksiyonun asıl işi
 * budur. `"1.250"` iki şey olabilir: TR binlik ayracıyla **1250** ya da nokta
 * ondalığıyla **1,25**. Düz `Number("1.250")` ikincisini seçer ve operatör
 * 1250 TL'lik masrafı **1,25 TL** olarak kaydeder: hata yok, log yok, yalnız
 * bin kat yanlış bir kasa. Para alanında tahmin etmenin bedeli budur; bu
 * yüzden binlik grubu görünümü ve iki ayraçlı yazım (`1.250,00`) kabul
 * EDİLMEZ ve `amountHint` sebebi söyler. `1.25` (üç haneden az) ondalıktır ve
 * geçerlidir — ayrım "noktadan sonra tam üç hane" testidir.
 *
 * ⚠️ Backend `decimalString` (number | string) kabul edip Decimal'e çevirir;
 * ağa giden değer NOKTALI STRING'dir. Sayıya çevirme yalnız DOĞRULAMA
 * içindir — `wire` kullanıcının yazdığı metnin normalize hâlidir, kayan
 * noktadan geçirilmiş hâli değil.
 */
export function parseAmount(text: string): { value: number; wire: string } | null {
  const raw = text.trim().replace(/\s/g, "");
  if (raw === "") return null;
  if ((raw.match(/[.,]/g)?.length ?? 0) > 1) return null;
  if (THOUSANDS_LOOKING.test(raw)) return null;
  const normalized = raw.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, wire: normalized };
}

/**
 * Tutar kutusunun altındaki cümle. `null` = basma.
 *
 * ⚠️ REDDEDİLEN HER GİRDİYE "sıfırdan büyük bir tutar girin" DEMEK YANLIŞTIR:
 * `1.250,00` zaten sıfırdan büyüktür ve kullanıcı olmayan bir sorunu aramaya
 * başlar. Reddin gerçek sebebi biçimdir; cümle onu ve çözümü söyler.
 */
export function amountHint(text: string): string | null {
  const raw = text.trim();
  if (raw === "" || parseAmount(raw)) return null;
  if ((raw.replace(/\s/g, "").match(/[.,]/g)?.length ?? 0) > 1 || THOUSANDS_LOOKING.test(raw)) {
    return "Binlik ayracı kullanmayın — “1.250,00” yerine “1250,50” yazın (virgül ondalıktır).";
  }
  return "Sıfırdan büyük bir tutar girin.";
}

// -----------------------------------------------------------------------------
// ENGEL YÜKLEMLERİ
// -----------------------------------------------------------------------------

export interface AccountLike {
  kind: CashAccountKind;
  id: string;
  code: string;
  name: string;
  currency: Currency;
  isActive: boolean;
}

/** Hesap kimliği — TÜR anahtarın parçası (`cashAccountKey` gerekçesi). */
function sameAccount(a: AccountLike, b: AccountLike): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * MASRAF/GELİR/AÇILIŞ fişinin engelleri — yalnız GERÇEK ÇELİŞKİLER.
 *
 * ⚠️ "Henüz doldurulmadı" bir engel DEĞİLDİR (`null` döner): form açılır
 * açılmaz kırmızı bir cümle basmak, kullanıcıyı hata yapmış sanmaya iter.
 * Eksik alan `entryReady` ile ölçülür ve yalnız düğmeyi kapatır.
 */
export function entryBlockReason(account: AccountLike | null): string | null {
  if (!account) return null;
  if (!account.isActive) {
    return `"${account.name}" hesabı PASİF — bu hesaba hareket yazılamaz. Kasa & Banka ekranından aktifleştirin ya da başka hesap seçin.`;
  }
  return null;
}

export function entryReady(account: AccountLike | null, amountText: string, txnDate: string): boolean {
  return Boolean(account) && parseAmount(amountText) !== null && dayStartIso(txnDate) !== undefined;
}

/**
 * VİRMAN engelleri. SIRA BİLİNÇLİ: önce yapısal (aynı hesap), sonra durum
 * (pasif), sonra para birimi. Kullanıcı hesapları seçerken en somut sorunu
 * önce duyar; üçü aynı anda doğruysa da tek cümle basılır (üst üste üç uyarı
 * ekranı okunmaz yapar).
 *
 * ⚠️ FARKLI PARA BİRİMİ BİR KUR İŞLEMİDİR, virman değil — backend 400 verir ve
 * bu ekran aynı cümleyi GÖNDERMEDEN söyler. Kural buradan düşerse veri
 * bozulmaz; kullanıcı formu doldurup reddedilir.
 */
export function transferBlockReason(from: AccountLike | null, to: AccountLike | null): string | null {
  if (!from || !to) return null;
  if (sameAccount(from, to)) return "Kaynak ve hedef hesap aynı olamaz.";
  const passive = !from.isActive ? from : !to.isActive ? to : null;
  if (passive) {
    return `"${passive.name}" hesabı PASİF — virman yapılamaz. Kasa & Banka ekranından aktifleştirin ya da başka hesap seçin.`;
  }
  if (from.currency !== to.currency) {
    return `"${from.name}" ${from.currency}, "${to.name}" ${to.currency} — farklı para birimleri arasında virman YAPILMAZ. Bu bir kur işlemidir ve kur farkı ayrıca kaydedilmelidir.`;
  }
  return null;
}

export function transferReady(
  from: AccountLike | null,
  to: AccountLike | null,
  amountText: string,
  txnDate: string,
): boolean {
  return (
    Boolean(from) &&
    Boolean(to) &&
    parseAmount(amountText) !== null &&
    dayStartIso(txnDate) !== undefined &&
    transferBlockReason(from, to) === null
  );
}

// -----------------------------------------------------------------------------
// İPTAL KAPSAMI (yıkıcı işlem onayı)
// -----------------------------------------------------------------------------

export interface CancelScope {
  /** Onayda SOMUT olarak listelenecek satırlar — çıkan bacak önce. */
  legs: CashTxnRow[];
  isTransfer: boolean;
  /**
   * Virman ama karşı bacak ELDEKİ SAYFADA yok. İptal yine de İKİ bacağı alır
   * (backend grubu kendisi çözer) — ekran bunu SÖYLER, listeleyemediğini
   * gizlemez.
   */
  missingLeg: boolean;
}

/**
 * İptalin gerçek kapsamı. Yıkıcı-işlem kuralı gereği onay diyaloğu "N kayıt
 * etkilenecek" demez, kayıtları TEK TEK yazar.
 *
 * ⚠️ EN SESSİZ TUZAK — `null === null`: kapsam `r.transferGroupId ===
 * target.transferGroupId` ile kurulursa, virman OLMAYAN bir fişte (grup id'si
 * `null`) listedeki BÜTÜN carisiz fişler eşleşir ve onay ekranı onlarca
 * kaydı "iptal edilecek" diye sayar. Grup kapsamı yalnız target'ın grubu
 * DOLU iken kurulur.
 */
export function cancelScope(rows: readonly CashTxnRow[], target: CashTxnRow): CancelScope {
  const group = target.transferGroupId;
  if (!group) return { legs: [target], isTransfer: false, missingLeg: false };

  const legs = rows.filter((r) => r.transferGroupId === group);
  const known = legs.some((r) => r.id === target.id) ? legs : [target, ...legs];
  // Çıkan → giren: para önce çıkar, sonra girer; okunuş sırası da budur.
  const ordered = [...known].sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === "OUT" ? -1 : 1;
    return a.docNo < b.docNo ? -1 : a.docNo > b.docNo ? 1 : 0;
  });
  return { legs: ordered, isTransfer: true, missingLeg: ordered.length < 2 };
}
