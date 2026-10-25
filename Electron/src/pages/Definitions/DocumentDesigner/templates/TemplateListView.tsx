import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FlaskConical, History, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { documentTemplateService, type DocumentTemplateRow, type TemplateStatus } from "@/services/documentTemplateService";
import { VersionsSheet } from "../versions/VersionsSheet";
import { CopyTemplateDialog, DESIGNER_EDITOR_PATH, type CopyRequest } from "./CopyTemplateDialog";
import { SystemPreviewDialog } from "./SystemPreviewDialog";
import { TemplateGroup } from "./TemplateGroup";
import { TemplateRowMenu } from "./TemplateRowMenu";
import { useTemplateAccess } from "./useTemplateAccess";

const STATUS_TABS: ReadonlyArray<{ key: TemplateStatus; label: string }> = [
  { key: "ACTIVE", label: "Etkin" },
  { key: "ARCHIVED", label: "Arşiv" },
];

/** Şablon listesi (plan §4): belge türüne göre gruplu; durum süzgeci SUNUCUDA (`status`). */
export function TemplateListView() {
  const navigate = useNavigate();
  const access = useTemplateAccess();
  const [status, setStatus] = useState<TemplateStatus>("ACTIVE");
  const [copy, setCopy] = useState<CopyRequest | null>(null);
  const [systemPreview, setSystemPreview] = useState<string | null>(null);
  const [versionsOf, setVersionsOf] = useState<DocumentTemplateRow | null>(null);

  const contractsQ = useQuery({ queryKey: ["document-templates", "contracts"], queryFn: () => documentTemplateService.contracts() });
  const listQ = useQuery({ queryKey: ["document-templates", "list", status], queryFn: () => documentTemplateService.listAll({ status }) });
  const assignQ = useQuery({ queryKey: ["document-templates", "assignments"], queryFn: () => documentTemplateService.assignments() });

  const rows = listQ.data?.data ?? [];
  const contracts = contractsQ.data?.data ?? [];
  const groups = status === "ACTIVE" ? contracts : contracts.filter((c) => rows.some((r) => r.docType === c.docType));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Durum süzgeci">
          {STATUS_TABS.map((t) => (
            <button key={t.key} type="button" aria-pressed={status === t.key} onClick={() => setStatus(t.key)}
              className={cn("px-3 py-1.5 text-xs", status === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {t.label}
            </button>
          ))}
        </div>
        {access.designBlock && <span className="text-xs text-muted-foreground" data-testid="salt-okunur-notu">{access.designBlock}</span>}
        <Button size="sm" variant="outline" className="ml-auto h-8 text-xs" title="Editörü kayıt açmadan dene; hiçbir şey kaydedilmez" onClick={() => navigate(DESIGNER_EDITOR_PATH("new"))}>
          <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Kaydetmeden dene
        </Button>
      </div>
      {listQ.isLoading || contractsQ.isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Şablonlar yükleniyor…</div>
      ) : groups.length === 0 ? (
        <EmptyState icon={History} title={status === "ARCHIVED" ? "Arşivde şablon yok" : "Belge türü yok"} description={status === "ARCHIVED" ? "Arşivlenen şablonlar burada listelenir." : "Sözleşmesi tanımlı belge türü bulunamadı."} />
      ) : (
        <div className="grid min-h-0 gap-3 overflow-y-auto pb-4 xl:grid-cols-2">
          {groups.map((c) => (
            <TemplateGroup
              key={c.docType}
              docType={c.docType}
              copyable={c.copyable === true}
              showSystem={status === "ACTIVE"}
              rows={rows.filter((r) => r.docType === c.docType)}
              assignments={assignQ.data?.data}
              designBlock={access.designBlock}
              onPreviewSystem={() => setSystemPreview(c.docType)}
              onCopySystem={() => setCopy({ docType: c.docType, copyFrom: { kind: "system" }, sourceName: "Sistem" })}
              onBlank={() => setCopy({ docType: c.docType, copyFrom: { kind: "blank" }, sourceName: "" })}
              rowActions={(t) => (
                <>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(DESIGNER_EDITOR_PATH(t.id))}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> {access.canDesign && t.status === "ACTIVE" ? "Düzenle" : "Aç"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setVersionsOf(t)}>
                    <History className="mr-1 h-3.5 w-3.5" /> Sürümler
                  </Button>
                  <TemplateRowMenu template={t} access={access} onCopy={() => setCopy({ docType: t.docType, copyFrom: { kind: "template", id: t.id }, sourceName: t.name })} />
                </>
              )}
            />
          ))}
        </div>
      )}
      <CopyTemplateDialog request={copy} onClose={() => setCopy(null)} />
      <SystemPreviewDialog docType={systemPreview} onClose={() => setSystemPreview(null)} />
      <VersionsSheet template={versionsOf} onClose={() => setVersionsOf(null)} />
    </div>
  );
}
