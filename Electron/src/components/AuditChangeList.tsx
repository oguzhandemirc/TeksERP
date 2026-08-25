import { auditFieldLabel, auditValueText } from "@/lib/audit-labels";
import type { AuditChange } from "@/types/systemLog";

// =============================================================================
// "NE DEĞİŞTİ" listesi — Kayıt Geçmişi ile Aktivite Detayı'nın ORTAK gösterimi
// =============================================================================
// İki ekran aynı `changes` dizisini basıyor. Ayrı yazılsalardı biri UUID'yi ada
// çevirmeyi öğrenirken diğeri ham basmaya devam ederdi (DocVersionHistory'de
// aynı ders): tek bileşen, tek davranış.
//
// ⚠️ ETİKET ÖNCELİĞİ: sunucu `oldLabel`/`newLabel` çözebildiyse O basılır, ham
// UUID `title`da kalır (denetimde kimlik gerekebilir). Çözülemediyse ham değer
// basılır — fail-open, satır asla boş kalmaz.
// =============================================================================

export function AuditChangeList({ changes }: { changes: AuditChange[] }) {
  return (
    <div className="space-y-1">
      {changes.map((c, i) => {
        const oldText = c.oldLabel ?? auditValueText(c.old);
        const newText = c.newLabel ?? auditValueText(c.new);
        return (
          <div key={`${c.field}-${i}`} className="flex flex-wrap items-baseline gap-1.5 text-sm">
            <span className="font-medium">{auditFieldLabel(c.field)}:</span>
            <span className="text-muted-foreground line-through" title={String(c.old ?? "")}>
              {oldText}
            </span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium text-foreground" title={String(c.new ?? "")}>
              {newText}
            </span>
          </div>
        );
      })}
    </div>
  );
}
