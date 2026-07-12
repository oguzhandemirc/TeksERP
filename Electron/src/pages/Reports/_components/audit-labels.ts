// Denetim raporları için tableName/action → Türkçe etiketler.
//
// tableName haritası TEK KAYNAK `@/lib/audit-labels`'te (System/Activity ile
// paylaşılır — iki harita drift etmesin). Buradan re-export ediliyor.
export { tableLabel } from "@/lib/audit-labels";

// Action etiketi bu ekrana özel: raporlarda EMİR kipi ("Oluştur") + AUTH/SYSTEM
// event'leri. (Aktivite Günlüğü aynı action'ı geçmiş-zaman fiille gösterir.)
const ACTION_LABEL: Record<string, string> = {
  CREATE: "Oluştur",
  UPDATE: "Güncelle",
  DELETE: "Sil",
  LOGIN_SUCCESS: "Giriş Başarılı",
  LOGIN_FAILED: "Giriş Başarısız",
  LOGOUT: "Çıkış",
  STARTUP: "Sistem Başlangıcı",
  ERROR: "Sistem Hatası",
};

export function actionLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return ACTION_LABEL[raw] ?? raw;
}
