// Belge Tipleri kartı: ad · kod/sürüm/okuma · kural özeti · gönderen cari · varsayılan sahip · parti no alanı · Düzenle /
// Fotoğrafla yeniden işaretle / Sıfırla. Liste tablosunda satıra tıklayınca ayrıntı panelinde (`BelgeTipiSheet`) çizilir.
import { useState } from "react";
import { Camera, RotateCcw, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import type { BatchNoCandidateKind, SenderTemplatePatch, SenderTemplateView } from "./types";
import type { TemplateJson } from "./tanit/types";
import { UserTemplateEditButton } from "./tanit/UserTemplateEdit";
import { RemarkDialog } from "./tanit/RemarkDialog";
import { templateRuleLines } from "./tanit/templateRules";

/** S1b: panelde/tablette tanıtılan belge tipi (`u-…`); eski backend `kind` göndermez → koddan. */
export const isUserTemplate = (r: Pick<SenderTemplateView, "kind" | "code">) => r.kind === "USER" || r.code.startsWith("u-");
/** Yetim = dosyada artık olmayan dosya şablonu satırı (geri alınamaz). */
export const isOrphan = (r: SenderTemplateView) => !isUserTemplate(r) && !r.inFile;

const KIND_LABEL: Record<BatchNoCandidateKind, string> = {
  BARCODE: "barkod no", DOC: "evrak no", BATCH: "parti no", WORK_ORDER: "gönderenin emir no", ORDER: "sipariş no", FORM: "form no",
};

interface CardProps {
  row: SenderTemplateView;
  onPatch: (p: SenderTemplatePatch) => void;
  busy: boolean;
}

/** Parti no alanı seçimi — aday düğmeleri (tek tık = PATCH) + temizle; hatırlanan anahtar tanımda yoksa ayrıca gösterilir. */
function BatchNoKeyField({ row, onPatch, busy }: CardProps) {
  const candidates = row.batchNoCandidates;
  if (candidates === undefined || row.batchNoKey === undefined) return null;
  const current = row.batchNoKey;
  const orphan = current !== null && !candidates.some((c) => c.field === current);
  return (
    <div className="mt-3 min-w-0 space-y-1" data-testid={`batch-no-key-${row.code}`}>
      <div className="text-xs font-medium text-muted-foreground">Parti no alanı (onayda seçilen alan hatırlanır)</div>
      {candidates.length === 0 && <div className="text-xs text-muted-foreground">Bu şablonda parti no adayı tanımlı değil.</div>}
      {(candidates.length > 0 || current !== null) && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${row.name} parti no alanı`}>
          {candidates.map((c) => (
            <Button key={c.field} type="button" size="sm" variant={current === c.field ? "default" : "outline"} aria-pressed={current === c.field} disabled={busy} onClick={() => current !== c.field && onPatch({ batchNoKey: c.field })}>
              {c.label ?? c.field} <span className="ml-1 text-xs opacity-70">({KIND_LABEL[c.kind] ?? c.kind})</span>
            </Button>
          ))}
          {current !== null && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onPatch({ batchNoKey: null })} aria-label={`${row.name} parti no alanını temizle`}>
              <X className="mr-1 h-3.5 w-3.5" /> Temizle
            </Button>
          )}
        </div>
      )}
      {orphan && <div className="text-xs text-amber-700 dark:text-amber-300">Hatırlanan alan ({current}) şablon tanımında artık yok; temizleyin ya da başka alan seçin.</div>}
      {current === null && candidates.length > 0 && <div className="text-xs text-muted-foreground">Seçili değil: aday tekse o, değilse parti no taslakta seçilir.</div>}
    </div>
  );
}

function CardActions({ row, onPatch, busy, onReset }: CardProps & { onReset: () => void }) {
  const [remark, setRemark] = useState(false);
  if (!isUserTemplate(row)) {
    // Hazır (dosya) tip: tanımı koddadır; yalnız kullanılmaz yapılabilir.
    return <Button size="sm" variant="outline" disabled={busy} onClick={() => onPatch({ isActive: false })}>Kullanma</Button>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      <UserTemplateEditButton code={row.code} name={row.name} />
      <Button size="sm" variant="outline" onClick={() => setRemark(true)} data-testid={`template-remark-${row.code}`}>
        <Camera className="mr-1 h-3.5 w-3.5" /> Fotoğrafla yeniden işaretle
      </Button>
      <Button size="sm" variant="outline" className="text-destructive" onClick={onReset} data-testid={`template-reset-${row.code}`}>
        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Sıfırla
      </Button>
      {remark && <RemarkDialog code={row.code} name={row.name} onOpenChange={setRemark} />}
    </div>
  );
}

export function TemplateCard({ row, onPatch, busy, template, onReset }: CardProps & { template: TemplateJson | null; onReset: () => void }) {
  const rules = isUserTemplate(row) && template ? templateRuleLines(template) : [];
  return (
    <div className="rounded-lg border bg-card p-4" data-testid={`template-${row.code}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">
            {row.code} · sürüm {row.version} · {row.hitCount} okuma
          </div>
          {rules.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5" data-testid={`template-rules-${row.code}`}>
              {rules.map((r) => <Badge key={r} variant="secondary" className="font-normal">{r}</Badge>)}
            </div>
          )}
        </div>
        <CardActions row={row} onPatch={onPatch} busy={busy} onReset={onReset} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Gönderen cari</div>
          <CustomerPickerField value={row.senderCustomer?.id ?? null} onChange={(id) => onPatch({ senderCustomerId: id })} disabled={busy} variant="cari" clearable placeholder="Gönderen seç" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Varsayılan sahip (belgede sahip okunamazsa)</div>
          <CustomerPickerField value={row.defaultOwnerCustomer?.id ?? null} onChange={(id) => onPatch({ defaultOwnerCustomerId: id })} disabled={busy} clearable placeholder="Varsayılan sahip seç" />
        </div>
      </div>
      <BatchNoKeyField row={row} onPatch={onPatch} busy={busy} />
    </div>
  );
}

/** Kullanılmayan tip satırı: pasif/sıfırlanmış → "Geri al" (PATCH isActive: true); yetim → kilitli. */
export function UnusedRow({ row, onPatch, busy }: CardProps) {
  const orphan = isOrphan(row);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid={`unused-${row.code}`}>
      <span className="min-w-0">
        <span className="font-medium">{row.name}</span>
        <span className="ml-2 text-xs text-muted-foreground">{row.code} · sürüm {row.version} · {row.hitCount} okuma</span>
      </span>
      {orphan ? (
        <Badge variant="outline">Okuma motorunda artık yok</Badge>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onPatch({ isActive: true })} aria-label={`${row.name} geri al`}>
          <Undo2 className="mr-1 h-3.5 w-3.5" /> Geri al
        </Button>
      )}
    </div>
  );
}
