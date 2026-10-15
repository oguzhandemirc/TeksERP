// Kendi hesabını silme (Google Play hesap silme politikası) — açıklama metni tek yerde: ekran ve mağaza/gizlilik metni
// aynı cümleleri söylesin. Davranışın kaynağı sunucudur (`POST /oturum/hesap-sil`); burada yalnız anlatım ve biçim.
import type { AccountDeletion } from "../api/wire";
import { formatDate } from "./format";

export const DELETION_SUPPORT_EMAIL = "info@etkiliyazilim.com";

export const DELETION_EFFECTS: readonly string[] = [
  "Hesabınız hemen kapanır; bütün cihazlardaki oturumlarınız sonlanır ve bildirimler durur.",
  "Üyesi olduğunuz BÜTÜN fabrikalardaki hesabınız kapanır (yalnız seçili fabrika değil).",
  "30. günde adınız, e-posta adresiniz, parolanız ve doğrulama kodu bilginiz kalıcı olarak silinir.",
  "Güvenlik kayıtları (giriş ve işlem izi) yasal saklama süresi boyunca kişisel bilgi taşımadan saklanır; fabrikanın kendi verisi (sipariş, cari vb.) fabrikada kalır.",
  `Vazgeçerseniz 30 gün içinde fabrikanızın hesap yöneticisine ya da ${DELETION_SUPPORT_EMAIL} adresine başvurun; yeniden davetle erişiminiz açılır.`,
];

export const LAST_ADMIN_HINT = "Bir fabrikanın son hesap yöneticisiyseniz önce o fabrikada başka bir kişiyi hesap yöneticisi yapın.";

/** Başarı iletisi: kaç fabrikada kapandı ve kişisel verinin silineceği gün (fabrika dilimiyle). */
export function deletionDoneText(d: AccountDeletion): string {
  const where = d.tesisSayisi > 1 ? `${d.tesisSayisi} fabrikadaki hesabınız` : "Hesabınız";
  return `${where} kapatıldı. Kişisel verileriniz ${formatDate(d.silinme)} tarihinde silinecek.`;
}
