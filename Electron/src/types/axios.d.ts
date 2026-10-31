import "axios";

// Bir isteğe özel: response interceptor'ın genel hata toast'ını bastır.
// Çağıran kendi (daha anlamlı) mesajını göstermek istediğinde kullanılır —
// örn. tercih kaydı: "Tercihlerin kaydedilemedi" gibi tek, bağlama özel toast.
declare module "axios" {
  export interface AxiosRequestConfig {
    suppressErrorToast?: boolean;
    /** Okutma noktası belirsiz müşteri kodu 409'unu aday modalıyla kendi çözer (lib/customer-code-choice.ts). */
    customerCodeChoice?: boolean;
    /**
     * Başarılı yazım yanıtının `warnings`i genel TOSTA basılmasın (lib/serverNotes.ts):
     * `handled` — ekran uyarıyı kendi gösterir (satır içi / liste) · `silent` — istek
     * kullanıcı eylemi olmadan ya da yazarken gider (önizleme, heartbeat, otomatik kayıt).
     */
    serverWarnings?: "handled" | "silent";
  }
}
