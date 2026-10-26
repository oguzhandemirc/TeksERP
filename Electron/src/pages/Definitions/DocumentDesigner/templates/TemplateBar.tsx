import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Editor } from "grapesjs";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, History, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAttemptToken } from "@/lib/attemptToken";
import { documentTemplateService } from "@/services/documentTemplateService";
import type { DesignerDraft } from "../useDesignerDraft";
import { PublishDialog, type PublishTarget } from "../versions/PublishDialog";
import { SaveVersionDialog } from "../versions/SaveVersionDialog";
import { VersionsSheet } from "../versions/VersionsSheet";
import { publishBlockReason, readTemplateError, templateBadges, templateErrorText } from "./model";
import { buildSaveBody, type TemplateDocument } from "./useTemplateDocument";
import type { TemplateAccess } from "./useTemplateAccess";

export const DESIGNER_LIST_PATH = "/definitions/document-designer";

interface Props {
  editor: Editor | null;
  draft: DesignerDraft;
  doc: TemplateDocument;
  access: TemplateAccess;
}

/** Kayıtlı şablonun şeridi: ad + rozetler · Sürümler · Taslağı kaydet · Yayınla (plan §4 üst şerit). */
export function TemplateBar({ editor, draft, doc, access }: Props) {
  const navigate = useNavigate();
  const attempt = useAttemptToken();
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [publish, setPublish] = useState<PublishTarget | null>(null);
  const t = doc.template;

  const save = useMutation({
    mutationFn: (note: string) => documentTemplateService.saveVersion(t!.id, { ...buildSaveBody(editor, draft, doc.baseVersionId!, note), clientToken: attempt.token() }),
    onSuccess: (r) => {
      attempt.onSuccess();
      draft.markSaved();
      doc.setBase(r.data.version.id);
      void doc.refresh();
      if (r.data.created) toast.success(`v${r.data.version.versionNo} kaydedildi.`);
      else toast.info("Değişiklik yok; yeni sürüm açılmadı.");
      setWarnings(r.data.warnings);
      if (!r.data.warnings.length) setSaving(false);
    },
    onError: (e) => attempt.onFailure(e),
  });

  if (!t) return null;
  const archived = t.status === "ARCHIVED";
  const saveBlock = access.designBlock ?? (archived ? "Arşivdeki şablon düzenlenemez; önce arşivden çıkarın." : !doc.baseVersionId ? "Sürüm yükleniyor…" : null);
  const base = doc.baseVersion;
  const publishBlock = base?.isPublished
    ? "Bu sürüm zaten yayında."
    : publishBlockReason({ canPublish: access.canPublish, archived, dirty: draft.dirty, sodEnabled: access.sodEnabled, me: access.me, versionAuthor: base?.createdById });
  const saveError = save.error ? templateErrorText(readTemplateError(save.error), "Kaydedilemedi.") : null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-1.5" data-testid="sablon-seridi">
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate(DESIGNER_LIST_PATH)}>
        <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Şablonlar
      </Button>
      <span className="text-sm font-semibold">{t.name}</span>
      {base && <span className="text-xs text-muted-foreground">açık sürüm v{base.versionNo}</span>}
      <div className="flex flex-wrap gap-1">
        {templateBadges(t, undefined).map((b) => <Badge key={b.key} variant={b.tone}>{b.label}</Badge>)}
      </div>
      {access.designBlock && <span className="text-xs text-muted-foreground" data-testid="salt-okunur-notu">{access.designBlock}</span>}
      <div className="ml-auto flex flex-wrap gap-1">
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowVersions(true)}>
          <History className="mr-1.5 h-3.5 w-3.5" /> Sürümler
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!!saveBlock} title={saveBlock ?? undefined} onClick={() => { setWarnings([]); setSaving(true); }}>
          <Save className="mr-1.5 h-3.5 w-3.5" /> Taslağı kaydet
        </Button>
        <Button size="sm" className="h-8 text-xs" disabled={!!publishBlock || !base} title={publishBlock ?? undefined} onClick={() => base && setPublish({ template: t, version: base })}>
          <Send className="mr-1.5 h-3.5 w-3.5" /> Yayınla
        </Button>
      </div>
      <SaveVersionDialog open={saving} nextNo={(t.latestVersionNo ?? 0) + 1} pending={save.isPending} done={save.isSuccess && warnings.length > 0} error={saveError} warnings={warnings}
        onSave={(note) => save.mutate(note)} onClose={() => { save.reset(); setSaving(false); }} />
      <VersionsSheet template={showVersions ? t : null} access={access} dirty={draft.dirty} onClose={() => setShowVersions(false)}
        onRestored={(r) => r.created && void doc.load(r.version.id)} />
      <PublishDialog target={publish} access={access} onClose={() => setPublish(null)} />
    </div>
  );
}
