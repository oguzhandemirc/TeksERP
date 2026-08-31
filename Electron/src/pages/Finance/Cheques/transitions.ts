// =============================================================================
// ÇEK DURUM MAKİNESİ — BACKEND'İN AYNASI
// =============================================================================
// Kaynak: `Teks-Erp/src/services/cheque.service.ts` → her geçişin
// `loadForTransition(tx, id, <izin verilen durumlar>, <kind>, "<işlem adı>")`
// çağrısı. Buradaki tablo O ÇAĞRILARIN birebir kopyasıdır.
//
// ⚠️ NEDEN İSTEMCİDE DE VAR: kullanıcıya yapamayacağı bir düğmeyi göstermek,
// onu tıklatıp 409 yedirmek demektir. Eldivenli, vardiya ortasındaki bir
// kullanıcı için "denedim, kırmızı bir şey çıktı" ile "böyle bir düğme yok"
// arasındaki fark, işi bırakıp telefon açmakla açmamak arasındaki farktır.
//
// ⚠️ AMA BACKEND HÂLÂ TEK OTORİTEDİR. Bu tablo bir NEZAKET katmanıdır, bir sed
// değil: liste verisi saniyeler öncesine ait olabilir ve arada başkası çeki
// tahsil etmiş olabilir. O durumda atomik claim 409 verir ve mesajı ekrana
// olduğu gibi düşer. Buradaki tabloyu "koruma" sanıp backend'de gevşetme.
//
// ⚠️ TABLO DEĞİŞİRSE BACKEND'LE BİRLİKTE DEĞİŞİR. Sessiz ayrışmanın iki yönü de
// kötüdür: fazla göstermek 409 üretir, eksik göstermek MEŞRU BİR İŞİ ekrandan
// tamamen kaldırır ve kimse sebebini göremez (hata yok, log yok).
//
// KAPSAM DIŞI (bilinçli): ENDORSED bir çek iade/iptal EDİLEMEZ — kâğıt fiziksel
// olarak üçüncü tarafın elindedir. Ondan çıkışın tek yolu BOUNCE'tır ve backend
// listeleri tam olarak böyle yazılmıştır.
// =============================================================================
import type { ChequeKind, ChequeStatus, DecimalLike } from "./service";
import { toNum } from "./service";

export type ChequeAction =
  | "deposit"
  | "collect"
  | "collect-cancel"
  | "endorse"
  | "bounce"
  | "return"
  | "pay"
  | "cancel";

export interface ChequeActionDef {
  action: ChequeAction;
  /** Düğmenin üstünde yazan İŞİN ADI — "Tamam"/"Onayla" değil. */
  label: string;
  /** Ne olacağını bir cümlede söyleyen açıklama (onay diyaloğunun gövdesi). */
  effect: string;
  /** Yalnız bu yöndeki çekte çıkar; `null` = iki yön için de geçerli. */
  kind: ChequeKind | null;
  /** İzin verilen KAYNAK durumlar (backend `loadForTransition` listesi). */
  from: readonly ChequeStatus[];
  /** Hangi ek bilgi sorulur: banka zorunlu · kasa/banka · karşı cari · sebep · yok. */
  needs: "bank" | "account" | "cari" | "reason" | "none";
  /** `assertNotAllocated` kapısı — kapaması olan çekte backend 409 verir. */
  blockedByAllocation: boolean;
  /** Geri alınamayan / kötü sonuç bildiren işlem → onay kırmızı. */
  destructive: boolean;
}

export const CHEQUE_ACTIONS: readonly ChequeActionDef[] = [
  {
    action: "deposit",
    label: "Bankaya Ver (tahsile)",
    effect:
      "Çek tahsile/teminata bankaya verilmiş sayılır. PARA HAREKETİ OLMAZ — henüz tahsil edilmedi, banka bakiyesi değişmez.",
    kind: "RECEIVED",
    from: ["PORTFOLIO"],
    needs: "bank",
    blockedByAllocation: false,
    destructive: false,
  },
  {
    action: "collect",
    label: "Tahsil Et",
    effect:
      "Seçilen kasa/banka bakiyesi çek tutarı kadar ARTAR. Cari deftere ikinci bir satır YAZILMAZ — müşterinin borcu çek alındığında kapandı. Bu işlem geri alınamaz.",
    kind: "RECEIVED",
    from: ["PORTFOLIO", "AT_BANK"],
    needs: "account",
    blockedByAllocation: false,
    destructive: false,
  },
  {
    // K-2 (2026-08-14): COLLECTED artık tam terminal DEĞİL — tek meşru çıkışı
    // bu TİPLİ stornodur. Hesabı ve dönülecek durumu backend son COLLECT
    // olayından kendisi çözer; diyalog aynı bilgiyi ONAY METNİNDE somutlar.
    action: "collect-cancel",
    label: "Tahsili Geri Al",
    effect:
      "TAHSİL STORNOSU — para, tahsil edildiği kasa/banka hesabından TERS hareketle geri çekilir ve çek tahsil öncesi durumuna döner. Cari deftere ve fatura kapamalarına DOKUNULMAZ. Sebep zorunludur ve olay defterine yazılır.",
    kind: "RECEIVED",
    from: ["COLLECTED"],
    needs: "reason",
    // Backend `cancelCollect` kapama kontrolü YAPMAZ (bilinçli: tahsil stornosu
    // çekin varlığını yok etmez, kapama meşru kalır) — burada da engellenmez.
    blockedByAllocation: false,
    destructive: true,
  },
  {
    action: "endorse",
    label: "Ciro Et",
    effect:
      "Çek üçüncü bir cariye devredilir; ona olan BORCUMUZ azalır (deftere borç satırı yazılır). Çeki veren cariye dokunulmaz.",
    kind: "RECEIVED",
    from: ["PORTFOLIO", "AT_BANK"],
    needs: "cari",
    blockedByAllocation: false,
    destructive: false,
  },
  {
    action: "bounce",
    label: "Karşılıksız Kaydet",
    effect:
      "Çekin defter etkisi TERS KAYITLA geri alınır: müşterinin borcu yeniden doğar. Çek ciro edilmişse ciro ettiğiniz cariye de ters kayıt yazılır. Para hareketi olmaz.",
    kind: "RECEIVED",
    from: ["PORTFOLIO", "AT_BANK", "ENDORSED"],
    needs: "none",
    blockedByAllocation: true,
    destructive: true,
  },
  {
    action: "return",
    label: "Sahibine İade Et",
    effect:
      "Çek/senet sahibine geri verildi. Doğuştaki defter satırının TERSİ yazılır. Bu bir hata stornosu DEĞİL, gerçek bir ticari olaydır (örn. müşteri nakit ödeyip çekini geri aldı).",
    kind: null,
    from: ["PORTFOLIO", "AT_BANK", "ISSUED"],
    needs: "none",
    blockedByAllocation: true,
    destructive: true,
  },
  {
    action: "pay",
    label: "Ödendi İşaretle",
    effect:
      "Kendi çekimiz bankadan/kasadan ödendi: seçilen hesabın bakiyesi çek tutarı kadar AZALIR. Cari deftere satır yazılmaz — borcunuz çeki verdiğinizde kapanmıştı.",
    kind: "ISSUED",
    from: ["ISSUED"],
    needs: "account",
    blockedByAllocation: false,
    destructive: false,
  },
  {
    action: "cancel",
    label: "Kaydı İptal Et",
    effect:
      "KAYIT HATASI stornosu — çek hiç girilmemiş gibi defter ters kayıtla geri alınır. Satır silinmez, listede İPTAL olarak durur. Çek gerçekten elden çıktıysa bunun yerine İADE ya da KARŞILIKSIZ kullanılmalıdır.",
    kind: null,
    from: ["PORTFOLIO", "AT_BANK", "ISSUED"],
    needs: "reason",
    blockedByAllocation: true,
    destructive: true,
  },
];

/**
 * Bu satırda MEŞRU olan işlemler.
 *
 * Boş dizi dönmesi bir hata değil bir CEVAPTIR: terminal durumdaki (karşılıksız
 * / iade / ödenmiş / iptal) çekte yapılacak bir şey YOKTUR. Çağıran, gri düğme
 * çizmek yerine menüyü HİÇ çizmez. TEK istisna COLLECTED (K-2): oradan tek çıkış
 * "Tahsili Geri Al" stornosudur ve menüde yalnız o görünür.
 */
export function availableActions(row: { kind: ChequeKind; status: ChequeStatus }): ChequeActionDef[] {
  return CHEQUE_ACTIONS.filter(
    (def) => (def.kind === null || def.kind === row.kind) && def.from.includes(row.status),
  );
}

/**
 * Faturaya kapama engeli — VARSA sebebi döndürür, yoksa `null`.
 *
 * ⚠️ Bu engel yukarıdaki durum kuralından FARKLIDIR ve bu yüzden düğmeyi
 * GİZLEMEZ: durum kuralı "bu iş bu aşamada olmaz" der (kullanıcının
 * yapabileceği bir şey yok), kapama ise KALDIRILABİLİR bir ön koşuldur.
 * Kullanıcı düğmeyi görmeli, tıklamalı ve ne yapması gerektiğini okumalı —
 * backend de tam olarak bunu söylüyor ("… öncesinde kapamayı kaldırın").
 */
export function allocationBlockReason(
  row: { allocatedTotal: DecimalLike; currency: string },
  def: ChequeActionDef,
): string | null {
  if (!def.blockedByAllocation) return null;
  const allocated = toNum(row.allocatedTotal);
  if (allocated <= 0) return null;
  return `Bu çek/senet ${allocated.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${row.currency} tutarında faturaya kapatılmış — "${def.label}" öncesinde kapamayı kaldırın.`;
}
