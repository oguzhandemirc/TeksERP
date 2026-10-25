import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitCompare, Loader2, RotateCcw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { documentTemplateService, type DocumentTemplateRow, type SaveVersionResult, type TemplateVersionSummary } from "@/services/documentTemplateService";
import { publishBlockReason } from "../templates/model";
import type { TemplateAccess } from "../templates/useTemplateAccess";
import { docTypeLabel } from "../useDesignerDraft";
import { CompareDialog, type CompareTarget } from "./CompareDialog";
import { PublishDialog, type PublishTarget } from "./PublishDialog";
import { RestoreDialog, type RestoreTarget } from "./RestoreDialog";

export const versionsQueryKey = (id: string | undefined) => ["document-templates", "versions", id] as const;
const templateKey = (id: string | undefined) => ["document-templates", "template", id ?? null] as const;

interface RowProps {
  v: TemplateVersionSummary;
  selected: boolean;
  onSelect: (on: boolean) => void;
  publishBlock: string | null;
  restoreBlock: string | null;
  isLatest: boolean;
  onPublish: () => void;
  onRestore: () => void;
}

function VersionRow({ v, selected, onSelect, publishBlock, restoreBlock, isLatest, onPublish, onRestore }: RowProps) {
  return (
    <li className="space-y-1 px-3 py-2" data-testid="surum-satiri">
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox checked={selected} onCheckedChange={(c) => onSelect(c === true)} aria-label={`v${v.versionNo} karşılaştırmaya ekle`} />
        <span className="font-mono text-sm font-semibold">v{v.versionNo}</span>
        {v.isPublished && <Badge variant="secondary">Yayında</Badge>}
        {!v.isPublished && v.publishedAt && <Badge variant="muted">Önceden yayınlandı</Badge>}
        {v.editMode === "CODE" && <Badge variant="outline">Kod kipi</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{fmtFactoryDateTime(v.createdAt)}</span>
      </div>
      <div className="pl-6 text-xs text-muted-foreground">
        Yazan: {v.createdByName ?? "—"}
        {v.publishedAt && ` · Yayınlayan: ${v.publishedByName ?? "—"} (${fmtFactoryDateTime(v.publishedAt)})`}
      </div>
      {v.note && <p className="pl-6 text-xs">{v.note}</p>}
      <div className="flex flex-wrap gap-1 pl-6">
        {!v.isPublished && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!publishBlock} title={publishBlock ?? undefined} onClick={onPublish}>
            <Send className="mr-1 h-3.5 w-3.5" /> {v.publishedAt ? "Bu sürümü yeniden yayınla" : "Yayınla"}
          </Button>
        )}
        {!isLatest && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!restoreBlock} title={restoreBlock ?? undefined} onClick={onRestore}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Bu sürümden taslak
          </Button>
        )}
      </div>
    </li>
  );
}

interface Props {
  template: DocumentTemplateRow | null;
  access: TemplateAccess;
  onClose: () => void;
  /** Editörde kaydedilmemiş değişiklik varsa geri alma onu ezer → pasif. */
  dirty?: boolean;
  onRestored?: (r: SaveVersionResult) => void;
}

/** Sürüm geçmişi (plan §4): liste · iki sürüm karşılaştırma · yeniden yayınla · bu sürümden taslak. Hiçbir sürüm silinmez. */
export function VersionsSheet({ template: given, access, onClose, dirty = false, onRestored }: Props) {
  // Panel her açılışta tazeler: başka oturumun kaydettiği sürüm önbellekte görünmez kalmasın.
  const fresh = useQuery({ queryKey: templateKey(given?.id), enabled: !!given, staleTime: 0, queryFn: () => documentTemplateService.get(given!.id) });
  const template = fresh.data?.data ?? given;
  const q = useQuery({ queryKey: versionsQueryKey(given?.id), enabled: !!given, staleTime: 0, queryFn: () => documentTemplateService.versions(given!.id) });
  const versions = q.data?.data ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [compare, setCompare] = useState<CompareTarget | null>(null);
  const [publish, setPublish] = useState<PublishTarget | null>(null);
  const [restore, setRestore] = useState<RestoreTarget | null>(null);
  useEffect(() => setPicked([]), [given?.id]);

  const pair = versions.filter((v) => picked.includes(v.id)).sort((a, b) => a.versionNo - b.versionNo);
  const archived = template?.status === "ARCHIVED";
  const restoreBlock = access.designBlock ?? (archived ? "Arşivdeki şablona sürüm eklenmez." : dirty ? "Kaydedilmemiş değişiklik var; önce kaydedin ya da vazgeçin." : null);
  return (
    <Sheet open={!!given} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Sürümler — {template?.name}</SheetTitle>
          <SheetDescription>{template ? docTypeLabel(template.docType) : ""} · her kayıt yeni ve değişmez bir sürümdür; geri alma da yeni sürüm açar.</SheetDescription>
        </SheetHeader>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={pair.length !== 2} onClick={() => template && pair.length === 2 && setCompare({ template, pair: [pair[0]!, pair[1]!] })}>
            <GitCompare className="mr-1.5 h-4 w-4" /> Karşılaştır
          </Button>
          <span className="text-xs text-muted-foreground">{pair.length === 2 ? "2 sürüm seçili" : "Karşılaştırmak için iki sürüm seçin"}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {q.isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Sürümler yükleniyor…</div>
          ) : versions.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Henüz sürüm yok.</p>
          ) : (
            <ul className="divide-y">
              {versions.map((v, i) => (
                <VersionRow key={v.id} v={v} isLatest={i === 0}
                  selected={picked.includes(v.id)}
                  onSelect={(on) => setPicked((p) => (on ? [...p.filter((x) => x !== v.id), v.id].slice(-2) : p.filter((x) => x !== v.id)))}
                  publishBlock={publishBlockReason({ canPublish: access.canPublish, archived, sodEnabled: access.sodEnabled, me: access.me, versionAuthor: v.createdById })}
                  restoreBlock={restoreBlock}
                  onPublish={() => template && setPublish({ template, version: v })}
                  onRestore={() => template && setRestore({ template, version: v, latest: versions[0]! })}
                />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
      <CompareDialog target={compare} onClose={() => setCompare(null)} />
      <PublishDialog target={publish} access={access} onClose={() => setPublish(null)} />
      <RestoreDialog target={restore} onClose={() => setRestore(null)} onRestored={onRestored} />
    </Sheet>
  );
}
