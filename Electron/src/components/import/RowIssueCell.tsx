import { useEffect, useState } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ImportColumn, ImportRowIssue, ImportRowResult, ImportTemplateSpec } from "@/services/importService";

/**
 * Bir önizleme satırının "Açıklama" hücresi — sorunlar SÜTUNA GÖRE kovalanır
 * ve düzeltilebilir olanın yanına input çizilir.
 *
 * Neden ızgara değil: bazı şablonlar 15-20 sütun taşıyor; diyalog içinde tam
 * ızgara Excel'den kalıcı olarak kötü olur ve eşleme adımıyla aynı zihinsel
 * modeli yarışa sokar. Kullanıcının düzeltmesi gereken şey zaten sunucunun
 * işaret ettiği hücredir.
 *
 * ⚠️ GRUPLU SATIRLARDA input ÇİZİLMEZ (`rowNos.length > 1`): orada
 * `result.rowNo` grubun BAŞIdır ama sorun bir ÇOCUK satırdan gelebilir —
 * bağlarsak yanlış dosya satırını, üstelik sessizce düzenlemiş oluruz.
 */
export function RowIssueCell({
  spec,
  row,
  cells,
  onEdit,
  renderFix,
}: {
  spec: ImportTemplateSpec;
  row: ImportRowResult;
  /** Bu satırın GÜNCEL hücre değerleri (düzeltmeler uygulanmış hâli). */
  cells: Record<string, string>;
  onEdit: (rowNo: number, column: string, value: string) => void;
  /** Varsa "eksik kaydı yarat" düğmesi — sorun bazlı. */
  renderFix?: (issue: ImportRowIssue) => React.ReactNode;
}) {
  const grouped = Boolean(row.rowNos && row.rowNos.length > 1);
  const byColumn = new Map<string, { errors: ImportRowIssue[]; warnings: ImportRowIssue[] }>();
  const rowLevel: { errors: ImportRowIssue[]; warnings: ImportRowIssue[] } = { errors: [], warnings: [] };

  const bucket = (col: string | undefined) => {
    if (!col) return rowLevel;
    let b = byColumn.get(col);
    if (!b) {
      b = { errors: [], warnings: [] };
      byColumn.set(col, b);
    }
    return b;
  };
  for (const e of row.errors) bucket(e.column).errors.push(e);
  for (const w of row.warnings) bucket(w.column).warnings.push(w);

  const editableCols = new Map<string, ImportColumn>();
  for (const key of byColumn.keys()) {
    const col = spec.columns.find((c) => c.key === key);
    if (col && !col.readOnly) editableCols.set(key, col);
  }

  return (
    <div className="space-y-1.5">
      {[...byColumn.entries()].map(([key, b]) => {
        const col = editableCols.get(key);
        return (
          <div key={key} className="space-y-0.5">
            {b.errors.map((e, i) => (
              <div key={`e${i}`} className="flex items-start gap-1 text-destructive">
                <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{e.message}</span>
              </div>
            ))}
            {b.warnings.map((w, i) => (
              <div key={`w${i}`} className="flex items-start gap-1 text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{w.message}</span>
              </div>
            ))}
            {col && !grouped ? (
              <CellInput
                label={col.label}
                value={cells[key] ?? ""}
                onCommit={(v) => onEdit(row.rowNo, key, v)}
              />
            ) : null}
            {renderFix ? b.errors.map((e, i) => <div key={`f${i}`}>{renderFix(e)}</div>) : null}
          </div>
        );
      })}

      {rowLevel.errors.map((e, i) => (
        <div key={`re${i}`} className="flex items-start gap-1 text-destructive">
          <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {e.message}
            {/* Satır düzeyi sorun tek hücrede düzeltilemez — kullanıcıyı
                boşuna input aramaya göndermemek için açıkça söylüyoruz. */}
            <span className="block text-muted-foreground">Bu sorun tek hücrede düzeltilemez.</span>
          </span>
        </div>
      ))}
      {rowLevel.warnings.map((w, i) => (
        <div key={`rw${i}`} className="flex items-start gap-1 text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{w.message}</span>
        </div>
      ))}

      {grouped && byColumn.size > 0 ? (
        <p className="text-muted-foreground">
          Bu satır grubunu dosyada düzeltin — grup birden fazla satırdan oluşuyor.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Düzeltme girişi. ⚠️ Commit BLUR/Enter'da, Escape geri alır — tuş başına
 * commit, 10.000 satırlık türetimi her karakterde yeniden koşturur ve "vazgeç"i
 * imkânsız kılardı.
 */
function CellInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Dışarıdan değişirse (ör. "eksik kaydı yarat" hücreye kod yazdı) yansıt.
  useEffect(() => setDraft(value), [value]);

  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}:</span>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-7 max-w-[220px] text-xs"
      />
    </div>
  );
}
