import type { ReactNode } from "react";
import { Copy, Eye, FilePlus2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DocumentTemplateRow, TemplateAssignments } from "@/services/documentTemplateService";
import { docTypeLabel } from "../useDesignerDraft";
import { templateBadges } from "./model";
import { NO_EQUIVALENT_TEXT } from "./SystemPreviewDialog";

interface Props {
  docType: string;
  copyable: boolean;
  /** Arşiv görünümünde Sistem satırı gösterilmez (Sistem arşivlenmez). */
  showSystem: boolean;
  rows: DocumentTemplateRow[];
  assignments: TemplateAssignments | undefined;
  designBlock: string | null;
  onPreviewSystem: () => void;
  onCopySystem: () => void;
  onBlank: () => void;
  rowActions: (t: DocumentTemplateRow) => ReactNode;
}

/** Bir belge türünün grubu: ilk satır "Sistem" (salt-okunur), altında şablonlar + rozetleri. */
export function TemplateGroup({ docType, copyable, showSystem, rows, assignments, designBlock, onPreviewSystem, onCopySystem, onBlank, rowActions }: Props) {
  const label = docTypeLabel(docType);
  return (
    <section className="rounded-md border bg-card" aria-label={label} data-testid={`sablon-grubu-${docType}`}>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground">{rows.length} şablon</span>
        {showSystem && (
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" disabled={!!designBlock} title={designBlock ?? "Boş sayfayla yeni şablon"} onClick={onBlank}>
            <FilePlus2 className="mr-1 h-3.5 w-3.5" /> Boş şablon
          </Button>
        )}
      </header>
      <ul className="divide-y">
        {showSystem && (
          <li className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="sistem-satiri">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Sistem</span>
            <Badge variant="muted">Salt-okunur</Badge>
            {!copyable && <span className="text-xs text-muted-foreground">henüz kopyalanabilir tasarım yok</span>}
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" title="Sistem tasarımını önizle" onClick={onPreviewSystem}>
                <Eye className="mr-1 h-3.5 w-3.5" /> Önizle
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!copyable || !!designBlock} title={!copyable ? NO_EQUIVALENT_TEXT : designBlock ?? "Kopyala ve düzenle"} onClick={onCopySystem}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Kopyala ve düzenle
              </Button>
            </div>
          </li>
        )}
        {rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="sablon-satiri">
            <span className="min-w-0 truncate text-sm font-medium" title={t.description ?? t.name}>{t.name}</span>
            <div className="flex flex-wrap gap-1">
              {templateBadges(t, assignments).map((b) => (
                <Badge key={b.key} variant={b.tone} data-rozet={b.key}>{b.label}</Badge>
              ))}
            </div>
            <div className="ml-auto flex gap-1">{rowActions(t)}</div>
          </li>
        ))}
        {!showSystem && rows.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Bu türde arşivlenmiş şablon yok.</li>}
      </ul>
    </section>
  );
}
