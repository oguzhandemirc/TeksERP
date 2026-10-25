import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { documentTemplateService, type DocumentTemplateRow, type TemplateVersionSummary } from "@/services/documentTemplateService";
import { docTypeLabel } from "../useDesignerDraft";

export const versionsQueryKey = (id: string | undefined) => ["document-templates", "versions", id] as const;

function VersionRow({ v }: { v: TemplateVersionSummary }) {
  return (
    <li className="space-y-1 px-3 py-2" data-testid="surum-satiri">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">v{v.versionNo}</span>
        {v.isPublished && <Badge variant="secondary">Yayında</Badge>}
        {!v.isPublished && v.publishedAt && <Badge variant="muted">Önceden yayınlandı</Badge>}
        {v.editMode === "CODE" && <Badge variant="outline">Kod kipi</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{fmtFactoryDateTime(v.createdAt)}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        Yazan: {v.createdByName ?? "—"}
        {v.publishedAt && ` · Yayınlayan: ${v.publishedByName ?? "—"} (${fmtFactoryDateTime(v.publishedAt)})`}
      </div>
      {v.note && <p className="text-xs">{v.note}</p>}
    </li>
  );
}

/** Sürüm geçmişi (plan §4): no, yazan, zaman, not, yayın rozeti. Sürümler DEĞİŞMEZ; hiçbiri silinmez. */
export function VersionsSheet({ template, onClose }: { template: DocumentTemplateRow | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: versionsQueryKey(template?.id),
    enabled: !!template,
    queryFn: () => documentTemplateService.versions(template!.id),
  });
  const versions = q.data?.data ?? [];
  return (
    <Sheet open={!!template} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Sürümler — {template?.name}</SheetTitle>
          <SheetDescription>{template ? docTypeLabel(template.docType) : ""} · her kayıt yeni ve değişmez bir sürümdür.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {q.isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Sürümler yükleniyor…</div>
          ) : versions.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Henüz sürüm yok.</p>
          ) : (
            <ul className="divide-y">{versions.map((v) => <VersionRow key={v.id} v={v} />)}</ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
