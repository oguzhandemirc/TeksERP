import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { documentTemplateService, type DocumentTemplateRow, type ProfileCatalogRow } from "@/services/documentTemplateService";
import { readTemplateError, templateErrorText } from "../templates/model";
import { docTypeLabel } from "../useDesignerDraft";
import { affectedNames, hasConfigOverride, isNoop } from "./assignmentModel";

export interface AssignTarget {
  docType: string;
  /** null = tür varsayılanı. */
  profile: ProfileCatalogRow | null;
  current: { id: string; name: string } | null;
  candidates: DocumentTemplateRow[];
  /** Varsayılan değişiminde kendi ataması olduğu için etkilenmeyen profiller. */
  shielded: ProfileCatalogRow[];
}

function Affected({ target }: { target: AssignTarget }) {
  if (!target.profile) {
    return (
      <div className="text-xs" data-testid="etkilenenler">
        <p className="font-medium">Etkilenen: bu türde profil ataması olmayan TÜM müşteri ve fasoncular.</p>
        {target.shielded.length > 0 && <p className="text-muted-foreground">Etkilenmeyen (kendi ataması var): {target.shielded.map((p) => p.name).join(", ")}</p>}
      </div>
    );
  }
  const a = affectedNames(target.profile);
  return (
    <div className="text-xs" data-testid="etkilenenler">
      <p className="font-medium">Etkilenen: {a.customers.length} müşteri · {a.subcontractors.length} fasoncu</p>
      <ul className="max-h-28 overflow-y-auto">
        {a.customers.map((c) => <li key={c.id}>Müşteri — {c.name}</li>)}
        {a.subcontractors.map((s) => <li key={s.id}>Fasoncu — {s.name}</li>)}
        {a.total === 0 && <li className="text-muted-foreground">Bu profile bağlı cari yok.</li>}
      </ul>
    </div>
  );
}

/** Atama (yıkıcı işlem kuralı): seçim + etkilenen her cari listelenir; onaydan sonra PUT. Seçici doğrudan modaldır. */
export function AssignDialog({ target, note, onClose }: { target: AssignTarget | null; note: string | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => setPick(target?.current?.id ?? null), [target]);
  const save = useMutation({
    mutationFn: () =>
      target!.profile
        ? documentTemplateService.setProfile(target!.profile.id, target!.docType, pick)
        : documentTemplateService.setDefault(target!.docType, pick),
    onSuccess: () => {
      toast.success("Atama kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["document-templates"] });
      onClose();
    },
  });
  if (!target) return null;
  const err = save.error ? templateErrorText(readTemplateError(save.error), "Atama kaydedilemedi.") : null;
  const fallback = target.profile ? "Tür varsayılanına bırak (profil ataması yok)" : "Sistem tasarımı (varsayılan yok)";
  const options: Array<{ id: string | null; label: string }> = [{ id: null, label: fallback }, ...target.candidates.map((c) => ({ id: c.id, label: `${c.name} · yayında v${c.publishedVersion?.versionNo ?? "?"}` }))];
  return (
    <Dialog open onOpenChange={(o) => !o && (save.reset(), onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{target.profile ? `${target.profile.name} — şablon ata` : "Tür varsayılanı"}</DialogTitle>
          <DialogDescription>{docTypeLabel(target.docType)} · şu an: {target.current?.name ?? fallback}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Şablon" className="max-h-48 space-y-1 overflow-y-auto">
          {options.map((o) => (
            <button key={o.id ?? "yok"} type="button" role="radio" aria-checked={pick === o.id} onClick={() => setPick(o.id)}
              className={cn("w-full rounded border px-2 py-1.5 text-left text-sm", pick === o.id ? "border-primary bg-primary/10" : "hover:bg-muted")}>
              {o.label}
            </button>
          ))}
          {target.candidates.length === 0 && <p className="text-xs text-muted-foreground">Bu türde atanabilir şablon yok — yalnız etkin ve yayınlanmış şablon atanır.</p>}
        </div>
        <Affected target={target} />
        {target.profile && hasConfigOverride(target.profile, target.docType) && (
          <div data-testid="ezme-uyarisi">
            <Callout tone="warning" title="Profilin belge ayarı ezmesi var">
              <p className="text-xs">{note ?? "Profil ayarı şablonlu basımda şablonun ayarının üstüne uygulanır."}</p>
            </Callout>
          </div>
        )}
        {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={isNoop(target.current, pick) || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Atamayı kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
