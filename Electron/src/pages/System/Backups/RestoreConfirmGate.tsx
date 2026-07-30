import { Callout } from "@/components/ui/callout";
import { TypeToConfirm } from "@/components/forms/TypeToConfirm";
import type { RestoreImpact } from "./restore-impact.types";

/**
 * Onay kapısı: blok sebepleri + yazarak onaylama.
 *
 * Beklenen metin VERİTABANI ADI, dosya adı değil — dosya zaten listeden bilinçli
 * seçildi; geri alınamaz olan, hangi veritabanının üzerine yazılacağıdır.
 */
export function RestoreConfirmGate({
  impact,
  typed,
  onTypedChange,
}: {
  impact: RestoreImpact;
  typed: string;
  onTypedChange: (v: string) => void;
}) {
  if (!impact.canRestore) {
    return (
      <Callout tone="danger" title="Bu yedek geri yüklenemez">
        <ul className="list-inside list-disc space-y-1">
          {impact.blockReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Callout>
    );
  }

  const db = impact.restoreTarget?.database ?? "";

  return (
    <div className="space-y-2">
      <Callout tone="danger" title="Bu işlem geri alınamaz">
        Geri yükleme <b>{db}</b> veritabanının tamamını yedekteki hâline döndürür. Yukarıda
        listelenen kayıtlar silinir.
      </Callout>
      <TypeToConfirm
        expected={db}
        value={typed}
        onChange={onTypedChange}
        label={
          <>
            Devam etmek için veritabanı adını yazın:{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono">{db}</code>
          </>
        }
      />
    </div>
  );
}
