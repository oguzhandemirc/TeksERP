// Tek satır: metre/kg/en yerinde düzenlenir (odak çıkınca), kumaş seçici modal + öneri, renk seçici modal + öneri.
import { Trash2, PackageSearch, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { SuggestionChips } from "./SuggestionChips";
import { LINE_STATUS_LABEL } from "./noteStatus";
import { parseTrNumber } from "./review-queue";
import { defaultItemHint, fallbackText } from "./approveFlow";
import { PROBLEM_LABEL } from "./reviewView";
import type { DeliveryNoteLine, EffectiveDefaultItem, LinePatch, NoteMatchSuggestions } from "./types";

interface Props {
  line: DeliveryNoteLine;
  suggestion: NoteMatchSuggestions["lines"][number] | undefined;
  editable: boolean;
  /** PARTIAL belgede topsuz FAILED satır: yalnız düzelt/atla. */
  fixable: boolean;
  selected: boolean;
  ownerCustomerId: string | null;
  /** Sahibin etkin varsayılanı (E4: müşteri > fabrika); undefined = okunamadı → ipucu yok. */
  defaultItem?: EffectiveDefaultItem | null;
  onSelect: () => void;
  onPatch: (p: LinePatch) => void;
  onDelete: () => void;
  onPickItem: () => void;
  /** Belge başına tek kayıt (PER_DOCUMENT): satır bilgidir → ürün/renk eşleme hücreleri çizilmez. */
  infoOnly?: boolean;
}

const tr = (v: string | null) => (v == null ? "" : String(Number(v)).replace(".", ","));

function NumCell({ value, onCommit, disabled, label, suspect = false }: { value: string | null; onCommit: (n: number | null) => void; disabled: boolean; label: string; suspect?: boolean }) {
  return (
    <Input
      key={value ?? ""}
      aria-label={label}
      aria-invalid={suspect || undefined}
      data-suspect={suspect ? "true" : undefined}
      title={suspect ? "Şüpheli el yazısı değeri — belgeyle karşılaştırın" : undefined}
      inputMode="decimal"
      defaultValue={tr(value)}
      disabled={disabled}
      className={`h-8 w-24 text-right tabular-nums ${suspect ? "border-2 border-destructive bg-destructive/10 font-semibold text-destructive" : ""}`}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const n = raw ? parseTrNumber(raw) : null;
        if (raw && n === null) return;
        if (n !== (value == null ? null : Number(value))) onCommit(n);
      }}
    />
  );
}

export function LineRow(p: Props) {
  const { line, editable } = p;
  const canEdit = editable || p.fixable;
  // Varsayılanla doğacak satırın bilgisi sunucudan (`itemFallback`, onayla aynı yüklem); eski backend → eşleşme yanıtının ipucu.
  const fb = line.itemFallback;
  const hint = fb ? null : defaultItemHint(p.defaultItem);
  const suspect = line.problems?.includes("SUSPECT_VALUE") ?? false;
  return (
    <tr className={`border-t align-top ${p.selected ? "bg-amber-50 dark:bg-amber-950/30" : ""} ${line.needsReview ? "border-l-4 border-l-amber-500" : ""}`} onClick={p.onSelect} data-testid="line-row">
      <td className="p-2 text-xs tabular-nums">
        {line.blockNo}/{line.lineNo}
        {line.lineKind === "ARABA" && <div className="text-[10px] text-muted-foreground">ARABA</div>}
      </td>
      <td className="p-2 text-xs">{line.senderRollNo ?? "—"}</td>
      <td className="p-2">
        <NumCell label="Metre" value={line.meters} disabled={!canEdit} suspect={suspect} onCommit={(n) => n !== null && p.onPatch({ meters: n })} />
        {line.needsReview && <div className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">Gözden geçir</div>}
      </td>
      <td className="p-2">
        <NumCell label="Kilo" value={line.weightKg} disabled={!canEdit} onCommit={(n) => p.onPatch({ weightKg: n })} />
      </td>
      <td className="p-2">
        <NumCell label="En" value={line.widthCm} disabled={!canEdit} onCommit={(n) => p.onPatch({ widthCm: n })} />
      </td>
      {!p.infoOnly && <MatchCells {...p} hint={hint} />}
      <td className="p-2">
        <Badge variant={line.status === "FAILED" ? "destructive" : line.status === "ENTERED" ? "default" : "muted"}>{LINE_STATUS_LABEL[line.status]}</Badge>
        {line.problems?.filter((c) => c !== "FAILED").map((c) => (
          <div key={c} className={`mt-0.5 text-[10px] ${c === "SUSPECT_VALUE" ? "font-semibold text-destructive" : "text-amber-700 dark:text-amber-400"}`} data-testid="line-problem" data-code={c}>{PROBLEM_LABEL[c] ?? c}</div>
        ))}
        {fb && (
          <div className="mt-0.5 max-w-[200px] text-[10px] text-sky-700 dark:text-sky-400" data-testid="line-item-fallback" data-source={fb.source}>
            {fallbackText(fb)}
          </div>
        )}
        {line.failReason && <div className="mt-0.5 max-w-[200px] text-[10px] text-destructive" data-testid="fail-reason">{line.failReason}</div>}
      </td>
      <td className="p-2">
        {editable && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Satırı sil" onClick={(e) => (e.stopPropagation(), p.onDelete())}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        {p.fixable && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Satırı atla" title="Bu kalem girilmeyecek — atla" onClick={(e) => (e.stopPropagation(), p.onPatch({ skip: true }))}>
            <SkipForward className="h-4 w-4" />
          </Button>
        )}
      </td>
    </tr>
  );
}

/** Ürün/renk eşleme hücreleri (PER_LINE); PER_DOCUMENT'ta satır bilgi olduğundan çizilmez. */
function MatchCells(p: Props & { hint: ReturnType<typeof defaultItemHint> }) {
  const hint = p.hint;
  return (
    <>
      <td className="min-w-[180px] p-2">
        <Button type="button" variant="outline" size="sm" className="h-8 max-w-full justify-start truncate" disabled={!(p.editable || p.fixable)} onClick={p.onPickItem}>
          <PackageSearch className="mr-1 h-3.5 w-3.5 shrink-0" />
          {p.line.item?.name ?? "Kumaş seç"}
        </Button>
        {!p.line.itemId && !p.line.rollId && p.line.status !== "SKIPPED" && hint && (
          <div className={`mt-0.5 text-[10px] ${hint.tone === "block" ? "text-destructive" : "text-sky-700 dark:text-sky-400"}`} data-testid="default-item-hint" data-source={hint.source} data-tone={hint.tone}>{hint.text}</div>
        )}
        {p.line.itemText && <div className="mt-0.5 text-[10px] text-muted-foreground">Belgede: {p.line.itemText}</div>}
        {p.editable && <SuggestionChips suggestion={p.suggestion?.item} currentId={p.line.itemId} onPick={(c) => p.onPatch({ itemId: c.id })} />}
      </td>
      <td className="min-w-[160px] p-2" onClick={(e) => e.stopPropagation()}>
        <ColorPickerModal value={p.line.colorId} onChange={(id) => p.onPatch({ colorId: id })} customerId={p.ownerCustomerId} disabled={!(p.editable || p.fixable)} triggerClassName="h-8" />
        {p.line.colorText && <div className="mt-0.5 text-[10px] text-muted-foreground">Belgede: {p.line.colorText}</div>}
        {p.editable && <SuggestionChips suggestion={p.suggestion?.color} currentId={p.line.colorId} onPick={(c) => p.onPatch({ colorId: c.id })} />}
      </td>
    </>
  );
}
