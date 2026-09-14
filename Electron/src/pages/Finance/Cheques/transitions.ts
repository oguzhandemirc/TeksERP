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
// olarak üçüncü tarafın elindedir. Çıkışı BOUNCE ya da (ciro kaydı yanlışsa)
// ciro stornosudur. Terminal durumların CANCELLED dışındaki her birinin tek
// çıkışı kendi tipli stornosudur.
// =============================================================================
import type { ChequeEventType, ChequeKind, ChequeStatus, DecimalLike } from "./service";
import { toNum } from "./service";

export type ChequeAction =
  | "deposit"
  | "collect"
  | "collect-cancel"
  | "endorse"
  | "endorse-cancel"
  | "bounce"
  | "bounce-cancel"
  | "return"
  | "return-cancel"
  | "pay"
  | "pay-cancel"
  | "deposit-cancel"
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
  /** Storno ise terslediği ileri olay — onay metni o olaydan somutlanır. */
  reverses?: ChequeEventType;
}

/** Storno sebebi soran ortak metin — beş storno ucu da aynı sözleşmeyi taşır. */
const REVERSAL_TAIL =
  "Asıl kayıt SİLİNMEZ; bugüne ters kayıt yazılır. Sebep zorunludur ve olay defterine yazılır.";

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
    reverses: "COLLECT",
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
    action: "endorse-cancel",
    label: "Ciroyu Geri Al",
    effect: `CİRO STORNOSU — ciro edilen cariye yazılan borç ters kayıtla kapanır ve çek ciro öncesi durumuna döner. ${REVERSAL_TAIL}`,
    kind: "RECEIVED",
    from: ["ENDORSED"],
    needs: "reason",
    // Backend `cancelEndorse` kapama kontrolü yapmaz: müşterinin ödemesi geçerli kalır.
    blockedByAllocation: false,
    destructive: true,
    reverses: "ENDORSE",
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
    action: "bounce-cancel",
    label: "Karşılıksızı Geri Al",
    effect: `KARŞILIKSIZ STORNOSU — müşteriye yazılan borç (çek ciro edilmişse ciro carisinin satırı da) ters kayıtla kapanır ve çek karşılıksız öncesi durumuna döner. ${REVERSAL_TAIL}`,
    kind: "RECEIVED",
    from: ["BOUNCED"],
    needs: "reason",
    // BOUNCED çekte kapama DB CHECK'iyle zaten sıfırdır.
    blockedByAllocation: false,
    destructive: true,
    reverses: "BOUNCE",
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
    action: "return-cancel",
    label: "İadeyi Geri Al",
    effect: `İADE STORNOSU — iadenin cari satırı ters kayıtla kapanır ve çek/senet iade öncesi durumuna döner. ${REVERSAL_TAIL}`,
    kind: null,
    from: ["RETURNED"],
    needs: "reason",
    // RETURNED çekte kapama DB CHECK'iyle zaten sıfırdır.
    blockedByAllocation: false,
    destructive: true,
    reverses: "RETURN",
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
    // Yanlış bankaya verilen çek tahsil edilmeden portföye döner (2026-09-14).
    // Para OYNAMAZ (bankaya verme de oynatmamıştı); hangi bankadan geri alındığı olay
    // defterinde kalır, başlıktaki banka düşer. Tahsil edilmişse önce tahsil stornosu.
    action: "deposit-cancel",
    label: "Bankaya Vermeyi Geri Al",
    effect: `BANKAYA VERME STORNOSU — çek "portföyde" durumuna döner, başlıktaki banka kalkar; para ve cari defter OYNAMAZ. ${REVERSAL_TAIL}`,
    kind: "RECEIVED",
    from: ["AT_BANK"],
    needs: "reason",
    blockedByAllocation: false,
    destructive: true,
    reverses: "DEPOSIT",
  },
  {
    action: "pay-cancel",
    label: "Ödemeyi Geri Al",
    effect: `ÖDEME STORNOSU — çek tutarı, ödendiği kasa/banka hesabına geri girer ve çek "verildi" durumuna döner. Cari deftere dokunulmaz (ödeme de dokunmamıştı). ${REVERSAL_TAIL}`,
    kind: "ISSUED",
    from: ["PAID"],
    needs: "reason",
    blockedByAllocation: false,
    destructive: true,
    reverses: "PAY",
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
 * Boş dizi dönmesi bir hata değil bir CEVAPTIR: İPTAL edilmiş çekte yapılacak
 * bir şey YOKTUR ve çağıran menüyü HİÇ çizmez. Diğer terminal durumlarda menüde
 * yalnız o durumun tipli stornosu görünür.
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
