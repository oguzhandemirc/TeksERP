// =============================================================================
// RESMÎ ÖN MUHASEBE BELGELERİ — ortak yaşam döngüsü kuralları (saf katman)
// =============================================================================
// Mutabakat mektubu (`MBT…`) ve çek teslim bordrosu (`BRD…`) kesildikten SONRA
// ne yapılabileceğini burası söyler. İki belge de aynı iskelette: ACTIVE doğar,
// donmuş `PrintedDocument`ı vardır, iptal edilince kayıt SİLİNMEZ — belge
// VOIDED'a çekilir ve İPTAL filigranıyla yeniden basılabilir.
//
// ⚠️⚠️ BU DOSYA NEDEN VAR (2026-08-15 çapraz incelemesi): iki belge de panelden
// KESİLEBİLİYOR ama kesildikten sonra bir daha ULAŞILAMIYORDU. Belgeye tek
// erişim, oluşturma diyaloğunun React state'inde yaşayan `createdId` idi;
// diyalog kapanınca (koşullu mount → state ölür) o `BRD…`/`MBT…` kaydına dönen
// hiçbir yol kalmıyordu. Sonuçları somuttu:
//   • Yanlış teslim tarihiyle kesilen bordro sonsuza dek ACTIVE kalıyordu —
//     backend'in `cancel` ucu (atomik claim + VOID zinciri + bekçi) yazılmıştı
//     ama HİÇBİR KULLANICI tetikleyemiyordu ("yazıldı ama mount edilmedi").
//   • Müşteri imzalı mutabakat mektubunun kopyasını isterse yeniden basılamıyordu.
//   • En önemlisi: `clientToken`ın bilinçli olarak atlanmasının gerekçesi
//     "mükerrer kopyanın maliyeti bir belge numarasıdır ve `cancel` TEK ADIMDA
//     kapatır" idi — o tek adım kullanıcı için MEVCUT DEĞİLDİ. Yani eksik yüzey,
//     başka bir kararın dayandığı telafiyi de götürüyordu.
// Bu yüzden iki liste diyaloğu (`ReconciliationLetterListDialog`,
// `ChequeDeliveryNoteListDialog`) eklendi ve kuralları — ekran içi `if`lerde
// değil — burada, ölçülebilir bir katmanda yaşıyor.
// =============================================================================

/** İki belgenin de durum uzayı (backend enum'larının ikizi). */
export type OfficialDocStatus = "ACTIVE" | "CANCELLED";

export const OFFICIAL_DOC_STATUS_LABEL: Record<OfficialDocStatus, string> = {
  ACTIVE: "Geçerli",
  CANCELLED: "İptal",
};

export const ALREADY_CANCELLED_ERROR = "Bu belge zaten iptal edilmiş.";

/**
 * Bu belge İPTAL EDİLEMİYORSA sebebi; edilebiliyorsa `null`.
 *
 * ⚠️ Sebep DÖNDÜRÜLÜR, `false` değil (proje sözleşmesi): sessizce kapalı bir
 * düğme "bozuk" diye okunur. Kuralı koruyan taraf yine sunucudur — backend
 * ikinci iptali ATOMİK CLAIM ile 409'a düşürür; burası nezakettir.
 */
export function officialDocCancelBlockReason(row: { status: OfficialDocStatus }): string | null {
  return row.status === "CANCELLED" ? ALREADY_CANCELLED_ERROR : null;
}

/**
 * İptal onayı metni — YIKICI İŞLEM KURALI: etkilenen kayıt SOMUT olarak yazılır
 * ("X kayıt etkilenecek" gibi soyut sayı yetmez, kök CLAUDE.md).
 *
 * ⚠️ Metin ne YAPILDIĞINI değil ne OLACAĞINI söyler ve iki gerçeği birden
 * taşır: (a) kayıt silinmez, belge İPTAL filigranıyla basılabilir kalır —
 * kullanıcı "geçmişi sileceğim" korkusuyla iptalden kaçınmasın; (b) geri dönüşü
 * yoktur, düzeltme yolu yenisini kesmektir.
 */
export function officialDocCancelSummary(docNo: string, detail?: string): string {
  const tail = detail ? ` (${detail})` : "";
  return (
    `${docNo}${tail} iptal edilecek. Kayıt SİLİNMEZ: belge “İPTAL” filigranıyla ` +
    "basılabilir olarak defterde kalır. Bu işlem geri alınamaz — düzeltme için " +
    "iptalden sonra yeni bir belge kesin."
  );
}
