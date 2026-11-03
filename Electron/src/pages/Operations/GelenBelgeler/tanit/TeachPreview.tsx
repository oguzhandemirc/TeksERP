// Önizleme: bu şablonla bu belge nasıl okunur (sunucu `POST /sablonlar/oneri`; yazmaz).
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { FIELD_OPTIONS } from "./teachDraft";
import type { SuggestResult } from "./types";

const FIELD_LABEL: Record<string, string> = Object.fromEntries(FIELD_OPTIONS.map((f) => [f.key, f.label]));
const DIRECTION: Record<string, string> = { right: "sağında", below: "altında" };

/** Açıklama satırı: "Parti No ← 'Ham PartiNo' sağında" ya da konumdan. */
export function explainText(e: SuggestResult["explain"][number]): string {
  const name = FIELD_LABEL[e.field] ?? e.field;
  if (e.strategy === "anchor" && e.label) return `${name} ← "${e.label}" ${DIRECTION[e.direction ?? ""] ?? "yanında"}`;
  return `${name} ← sayfadaki konumundan (yanında basılı etiket bulunamadı)`;
}

export function TeachPreview({ result, stale }: { result: SuggestResult; stale: boolean }) {
  const p = result.preview;
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm" data-testid="teach-preview">
      <h3 className="font-medium">Önizleme — bu şablonla bu belge</h3>
      {stale && <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="teach-preview-stale">İşaretleme değişti; kaydetmeden önce yeniden önizleyin.</p>}
      {result.errors.length > 0 && (
        <ul className="text-xs text-destructive" data-testid="teach-preview-errors">
          {result.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {p && (
        <>
          <p className={`flex items-center gap-1 ${p.matched ? "text-emerald-700 dark:text-emerald-400" : "text-amber-800 dark:text-amber-300"}`} data-testid="teach-preview-match">
            {p.matched ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {p.matched ? `Belge bu tip olarak tanınıyor (puan ${Math.round(p.score * 100)}).` : `Belge bu kimlik yazılarıyla tanınmıyor (puan ${Math.round(p.score * 100)}); daha belirgin kimlik yazıları seçin.`}
          </p>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-0.5" data-testid="teach-preview-fields">
            {Object.entries(p.fields).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{FIELD_LABEL[k] ?? k}</dt>
                <dd className="font-mono text-xs">{v ?? "— okunamadı"}</dd>
              </div>
            ))}
          </dl>
          {(p.blocks?.length ?? 0) > 1 && (
            <ul className="text-xs" data-testid="teach-preview-blocks">
              {p.blocks!.map((b) => <li key={b.blockNo}>Bölüm {b.blockNo}: parti {b.batchNo ?? "—"} · yazan top {b.topCount ?? b.count ?? "—"}</li>)}
            </ul>
          )}
          <p className="text-xs text-muted-foreground" data-testid="teach-preview-lines">Top satırı: {p.lineCount}</p>
          {p.warnings.length > 0 && <ul className="text-xs text-amber-800 dark:text-amber-300">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </>
      )}
      {result.explain.length > 0 && (
        <ul className="text-xs text-muted-foreground" data-testid="teach-preview-explain">
          {result.explain.map((e) => <li key={e.field}>{explainText(e)}</li>)}
        </ul>
      )}
    </div>
  );
}
