// Denetim raporları için tableName/action → Türkçe etiketler.
//
// tableName haritası TEK KAYNAK `@/lib/audit-labels`'te (System/Activity ile
// paylaşılır — iki harita drift etmesin). Buradan re-export ediliyor.
export { tableLabel } from "@/lib/audit-labels";

// Bu ekrana özel olan YALNIZ CRUD çekimidir: raporlarda EMİR kipi ("Oluştur"),
// Aktivite Günlüğü'nde geçmiş zaman ("oluşturdu"). Sistem olaylarının adı ortak
// sözlükten gelir — burada kopyası tutulduğunda 27 olayın 5'i biliniyordu ve
// geri kalanı raporda ham İngilizce çıkıyordu (`BACKUP_COMPLETED`, `DB_COPY_*`…).
import { eventActionLabel } from "@/lib/audit-labels";

const CRUD_LABEL: Record<string, string> = {
  CREATE: "Oluştur",
  UPDATE: "Güncelle",
  DELETE: "Sil",
};

export function actionLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return CRUD_LABEL[raw] ?? eventActionLabel(raw);
}
