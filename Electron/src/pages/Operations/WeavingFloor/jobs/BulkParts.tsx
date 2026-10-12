// Önizleme tablosu (etkilenen HER tezgah adıyla, satır başına seçim) ve sonuç raporu (Başladı · Olmadı · Uyarılar).
import { useCallback, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { OUTCOME_TEXT, rowKey, selectable } from "./plan";
import type { BulkPreviewRow } from "./runService";

interface PreviewProps {
  rows: readonly BulkPreviewRow[];
  picked: ReadonlySet<string>;
  onToggle: (key: string, on: boolean) => void;
  /** Satır başına ek giriş (Bitir: atkı sayacı). */
  extra?: (r: BulkPreviewRow) => React.ReactNode;
}

const lineText = (r: BulkPreviewRow) => (r.productionLineCount > 1 ? `${r.productionLineNo}. hat` : "—");

export function PreviewTable({ rows, picked, onToggle, extra }: PreviewProps) {
  return (
    <div className="max-h-[50vh] overflow-auto rounded border">
      <table className="w-full text-sm" aria-label="Etkilenecek tezgahlar">
        <thead className="sticky top-0 bg-muted text-left">
          <tr>
            <th className="w-8 p-2" />
            <th className="p-2">Tezgah</th>
            <th className="p-2">Hat</th>
            <th className="p-2">Şu anki iş</th>
            <th className="p-2">Ne olacak</th>
            {extra && <th className="p-2">Atkı sayacı</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            const can = selectable(r);
            return (
              <tr key={k} data-row={k} className={can ? "border-t" : "border-t text-muted-foreground"}>
                <td className="p-2">
                  <Checkbox
                    aria-label={`${r.machineCode} ${r.productionLineNo}. hat`}
                    checked={can && picked.has(k)}
                    disabled={!can}
                    onCheckedChange={(v) => onToggle(k, v === true)}
                  />
                </td>
                <td className="p-2">
                  <div className="font-medium">{r.machineCode}</div>
                  <div className="text-xs text-muted-foreground">{r.machineName}</div>
                </td>
                <td className="p-2">{lineText(r)}</td>
                <td className="p-2">{r.current ? (r.current.weavingOrderNumber ?? "İşsiz koşum") : "Boş"}</td>
                <td className="p-2">
                  <div>{r.block ? r.block.message : OUTCOME_TEXT[r.outcome]}</div>
                  {r.warnings.map((w) => (
                    <div key={w} className="text-xs text-amber-700">
                      ⚠ {w}
                    </div>
                  ))}
                </td>
                {extra && <td className="p-2">{can ? extra(r) : null}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface ResultRow {
  machineId: string;
  machineCode: string;
  /** Koşum sonucunda hat; duruş sonucunda yok (tezgah düzeyi). */
  productionLineNo?: number;
}

/** Koşum ve duruş toplu sonuçlarının ortak biçimi. */
export interface BulkResultLike {
  ok: ReadonlyArray<ResultRow & { warnings?: string[] }>;
  failed: ReadonlyArray<ResultRow & { message: string }>;
}

interface ResultProps {
  result: BulkResultLike;
  okTitle: string;
  onRetryFailed: (() => void) | null;
}

/** Sessiz kısmi başarı yok: olan ve olmayan tezgahlar adıyla, olmayan sebebiyle. */
export function ResultView({ result, okTitle, onRetryFailed }: ResultProps) {
  const warnings = result.ok.flatMap((o) => (o.warnings ?? []).map((w) => `${o.machineCode}: ${w}`));
  return (
    <div className="space-y-3 text-sm">
      <section aria-label={okTitle}>
        <h3 className="font-semibold">
          {okTitle} ({result.ok.length})
        </h3>
        <ul>
          {result.ok.map((o) => (
            <li key={`${o.machineId}:${o.productionLineNo ?? 1}`}>{o.machineCode}{(o.productionLineNo ?? 1) > 1 ? ` · ${o.productionLineNo}. hat` : ""}</li>
          ))}
        </ul>
      </section>
      {result.failed.length > 0 && (
        <section aria-label="Olmadı">
          <h3 className="font-semibold text-destructive">Olmadı ({result.failed.length})</h3>
          <ul>
            {result.failed.map((f) => (
              <li key={`${f.machineId}:${f.productionLineNo ?? 1}`}>
                <span className="font-medium">{f.machineCode}</span> — {f.message}
              </li>
            ))}
          </ul>
          {onRetryFailed && (
            <Button size="sm" variant="outline" className="mt-2" onClick={onRetryFailed}>
              Olmayanları yeniden dene
            </Button>
          )}
        </section>
      )}
      {warnings.length > 0 && (
        <section aria-label="Uyarılar">
          <h3 className="font-semibold">Uyarılar</h3>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Önizleme satırlarının işaret kümesi (satır anahtarıyla). */
export function usePickedRows() {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (k: string, on: boolean) =>
      setPicked((prev) => {
        const next = new Set(prev);
        if (on) next.add(k);
        else next.delete(k);
        return next;
      }),
    [],
  );
  return { picked, setPicked, toggle };
}
