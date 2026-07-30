import { Callout } from "@/components/ui/callout";
import { safeFormat } from "@/lib/format";
import { fmtBytes } from "../ServerStatus/serverHealth";
import type { RestoreImpact } from "./restore-impact.types";

function humanGap(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 0) return "gelecek bir tarih";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} dakika`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  if (h < 24) return rem ? `${h} saat ${rem} dakika` : `${h} saat`;
  const d = Math.floor(h / 24);
  return `${d} gün ${h % 24} saat`;
}

/**
 * Yedeğin kimliği + kesim anı. Kesim anı KAYNAĞIYLA birlikte gösterilir: mtime'a
 * düşüldüyse operatör bunu bilmeli, yoksa yanlış güven oluşur.
 */
export function RestoreImpactSummary({ impact }: { impact: RestoreImpact }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3 text-sm">
        <div className="font-mono text-xs">{impact.file.name}</div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Boyut</dt>
          <dd className="tabular-nums">{fmtBytes(impact.file.sizeBytes)}</dd>

          <dt className="text-muted-foreground">Kesim anı</dt>
          <dd className="tabular-nums">
            {safeFormat(impact.cutoff.at, "dd.MM.yyyy HH:mm:ss")}{" "}
            <span className="text-muted-foreground">
              ({impact.cutoff.source === "name" ? "dosya adından" : "dosya değişiklik zamanından"})
            </span>
          </dd>

          <dt className="text-muted-foreground">Yedekten bu yana</dt>
          <dd className="tabular-nums">{humanGap(impact.cutoff.at)}</dd>
        </dl>
      </div>

      {impact.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}
    </div>
  );
}
