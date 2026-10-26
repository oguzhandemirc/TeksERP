import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorMessage } from "@/services/apiClient";
import { documentTemplateService, type DocumentTemplateRow, type TemplateVersionSummary } from "@/services/documentTemplateService";
import { publishBlockReason, readTemplateError, templateErrorText, unsafeContentLines } from "../templates/model";
import type { TemplateAccess } from "../templates/useTemplateAccess";
import { publishImpact, scenarioRow, summarize, type ScenarioRow } from "./publishImpact";
import { versionPreviewRequest } from "./versionSource";

export interface PublishTarget {
  template: DocumentTemplateRow;
  version: TemplateVersionSummary;
}

const ICON = { ok: CheckCircle2, warning: AlertTriangle, failed: XCircle } as const;
const TONE = { ok: "text-emerald-600", warning: "text-amber-600", failed: "text-destructive" } as const;

/** Her senaryo sunucuda çizilir (istemci Liquid çalıştırmaz); asıl kapı yine yayın ucundadır. */
function useScenarioSummary(target: PublishTarget | null) {
  return useQuery({
    queryKey: ["document-templates", "publish-summary", target?.version.id],
    enabled: !!target,
    queryFn: async (): Promise<ScenarioRow[]> => {
      const { template, version } = target!;
      const [full, contract] = await Promise.all([
        documentTemplateService.version(template.id, version.id),
        documentTemplateService.contract(template.docType),
      ]);
      const rows: ScenarioRow[] = [];
      for (const s of contract.data.senaryolar) {
        try {
          const r = await documentTemplateService.preview(versionPreviewRequest(template.docType, full.data, s.ad));
          rows.push(scenarioRow(s.aciklama || s.ad, r.data));
        } catch (e) {
          rows.push(scenarioRow(s.aciklama || s.ad, null, apiErrorMessage(e, "Önizleme alınamadı")));
        }
      }
      return rows;
    },
  });
}

function ImpactList({ templateId }: { templateId: string }) {
  const q = useQuery({ queryKey: ["document-templates", "assignments"], queryFn: () => documentTemplateService.assignments() });
  const impact = publishImpact(templateId, q.data?.data);
  return (
    <div className="space-y-1 text-sm" data-testid="yayin-etkisi">
      <p className="font-medium">
        Etkilenen: {impact.profiles.length} profil · {impact.customerCount} müşteri · {impact.subcontractorCount} fasoncu
        {impact.isDefault && " · tür varsayılanı (profil ataması olmayan herkes)"}
      </p>
      {impact.profiles.length === 0 && !impact.isDefault && <p className="text-xs text-muted-foreground">Şablon henüz hiçbir yere atanmadı; yayın basımı etkilemez.</p>}
      <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
        {impact.profiles.map((p) => (
          <li key={p.id}>
            <span className="font-medium">{p.name}</span>: {[...p.customers, ...p.subcontractors].map((x) => x.name).join(", ") || "bağlı cari yok"}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Yayın onayı (plan §4): senaryo özeti + etkilenenler + `expectedPublishedVersionId` claim'i. */
export function PublishDialog({ target, access, onClose }: { target: PublishTarget | null; access: TemplateAccess; onClose: () => void }) {
  const qc = useQueryClient();
  const summary = useScenarioSummary(target);
  const publish = useMutation({
    mutationFn: () => documentTemplateService.publish(target!.template.id, { versionId: target!.version.id, expectedPublishedVersionId: target!.template.publishedVersionId }),
    onSuccess: () => {
      toast.success(`v${target!.version.versionNo} yayında.`);
      void qc.invalidateQueries({ queryKey: ["document-templates"] });
      onClose();
    },
  });
  const err = publish.error ? readTemplateError(publish.error) : null;
  const block = target
    ? publishBlockReason({ canPublish: access.canPublish, archived: target.template.status === "ARCHIVED", sodEnabled: access.sodEnabled, me: access.me, versionAuthor: target.version.createdById })
    : null;
  const counts = summarize(summary.data ?? []);
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && (publish.reset(), onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>v{target?.version.versionNo} yayınlansın mı?</DialogTitle>
          <DialogDescription>{target?.template.name} · yayındaki: {target?.template.publishedVersion ? `v${target.template.publishedVersion.versionNo}` : "yok"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1" data-testid="senaryo-ozeti">
          {summary.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Örnek senaryolar çiziliyor…</p>
          ) : (
            <>
              <p className="text-sm font-medium">Senaryolar: {counts.ok} başarılı · {counts.warning} uyarılı · {counts.failed} hatalı</p>
              <ul className="max-h-36 space-y-0.5 overflow-y-auto text-xs">
                {(summary.data ?? []).map((r) => {
                  const Icon = ICON[r.outcome];
                  return (
                    <li key={r.senaryo} className="flex gap-1.5"><Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE[r.outcome]}`} /><span>{r.senaryo}{r.detail && ` — ${r.detail}`}</span></li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        {target && <ImpactList templateId={target.template.id} />}
        {err && (
          <Callout tone="danger" title={templateErrorText(err, "Yayınlanamadı.")}>
            {err.code === "TEMPLATE_UNSAFE_CONTENT" && <ul className="list-disc pl-4 text-xs">{unsafeContentLines(err.details).map((l) => <li key={l}>{l}</li>)}</ul>}
            {err.code === "TEMPLATE_RENDER_FAILED" && <p className="text-xs">{err.message}</p>}
          </Callout>
        )}
        {block && <p className="text-xs text-muted-foreground" data-testid="yayin-engeli">{block}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          {err?.code === "TEMPLATE_PUBLISH_CONFLICT" ? (
            <Button onClick={() => { void qc.invalidateQueries({ queryKey: ["document-templates"] }); onClose(); }}>Yenile</Button>
          ) : (
            <Button disabled={!!block || publish.isPending || counts.failed > 0} title={block ?? (counts.failed ? "Hatalı senaryo var; yayın sunucuda reddedilir." : undefined)} onClick={() => publish.mutate()}>
              {publish.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Yayınla
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
