import { Callout } from "@/components/ui/callout";
import { formatNumber, safeFormat } from "@/lib/format";
import { tableLabel } from "@/lib/audit-labels";
import type { AuditRollup } from "./restore-impact.types";

/**
 * Toplam değişiklik izi — yukarıdaki sayımların INSERT-only sınırının telafisi.
 *
 * `SystemLog` (DOMAIN) her CUD'yi yazıyor, dolayısıyla UPDATE hacmini de içerir.
 * Bu panel olmadan "yalnız yeni kayıtları göster" yaklaşımı operatörü yanıltır.
 *
 * `available === false` → kapsam cutoff'a ulaşmıyor (archive-scheduler eski
 * log'ları taşımış). Bu durumda **0 GÖSTERİLMEZ**: "0 değişiklik" ile "ölçemedik"
 * arasındaki fark, yıkıcı bir karar verirken güvenilen tek şey.
 */
export function RestoreAuditDelta({ audit }: { audit: AuditRollup }) {
  if (!audit.available) {
    return (
      <Callout tone="warning" title="Değişiklik izi ölçülemedi">
        Denetim kaydı kapsamı bu yedeğin tarihine ulaşmıyor
        {audit.oldestLogAt && (
          <> (en eski kayıt: {safeFormat(audit.oldestLogAt, "dd.MM.yyyy HH:mm")})</>
        )}
        . Kayıtlarda yapılmış <b>değişikliklerin hacmi bilinmiyor</b> — sıfır olduğu anlamına
        gelmez.
      </Callout>
    );
  }

  const total = audit.created + audit.updated + audit.deleted;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Toplam değişiklik izi
      </h4>
      <p className="text-sm">
        Yedekten bu yana <b>en az {formatNumber(audit.created)}</b> kayıt oluşturuldu,{" "}
        <b>{formatNumber(audit.updated)}</b> kayıt güncellendi,{" "}
        <b>{formatNumber(audit.deleted)}</b> kayıt silindi.{" "}
        <span className="text-muted-foreground">
          Güncellemeler üstteki listede görünmez ama onlar da geri alınır.
        </span>
      </p>

      {audit.byTable.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {audit.byTable.map((t) => (
            <li key={t.tableName} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
              <span>{tableLabel(t.tableName)}</span>
              <span className="shrink-0 space-x-2 text-xs tabular-nums text-muted-foreground">
                <span title="oluşturuldu">+{formatNumber(t.created)}</span>
                <span title="güncellendi">~{formatNumber(t.updated)}</span>
                <span title="silindi">−{formatNumber(t.deleted)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {total > 0 && audit.byTable.length > 0 && (
        <p className="text-xs text-muted-foreground">
          En çok etkilenen {audit.byTable.length} tablo gösteriliyor. Denetim kaydı
          best-effort yazılır — rakamlar alt sınırdır.
        </p>
      )}
    </div>
  );
}
