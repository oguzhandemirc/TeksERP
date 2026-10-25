import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { DOCUMENT_TEMPLATE_DESIGN } from "@/lib/permissions";
import { DOC_TYPE_TO_KEY } from "@/services/documentConfig";
import { documentTemplateService, type DocumentTemplateRow } from "@/services/documentTemplateService";

const ASSIGNMENTS_KEY = ["document-templates", "assignments"] as const;

/** Seçili belge türünün varsayılan tasarımcı şablonu; sözleşmesi olmayan türde hiç çizilmez. */
export function DefaultTemplatePicker({ docKey }: { docKey: string }) {
  const docType = Object.entries(DOC_TYPE_TO_KEY).find(([, k]) => k === docKey)?.[0] ?? null;
  const enabled = useFeatureFlags().data?.data?.documentDesignerEnabled === true;
  const canDesign = useRoleAccess().hasAnyPermission(DOCUMENT_TEMPLATE_DESIGN);
  const contractsQ = useQuery({
    queryKey: ["document-templates", "contracts"],
    queryFn: documentTemplateService.contracts,
    staleTime: 5 * 60_000,
  });
  const hasContract = !!docType && (contractsQ.data?.data ?? []).some((c) => c.docType === docType);
  const assignQ = useQuery({
    queryKey: ASSIGNMENTS_KEY,
    queryFn: documentTemplateService.assignments,
    enabled: enabled && hasContract,
  });
  const [open, setOpen] = useState(false);
  if (!docType || !hasContract) return null;

  const current = assignQ.data?.data?.defaults.find((d) => d.docType === docType)?.template ?? null;
  return (
    <div className="rounded-md border px-3 py-3" data-testid="default-template-row">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Varsayılan şablon</div>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? `Yeni basılan belgeler: ${current ? `"${current.name}"` : "Sistem (bugünkü tasarım)"}. Müşteriye atanmış şablon bunu ezer.`
              : "Belge tasarımcısı kapalı — yeni belgeler Sistem tasarımıyla basılır."}
          </p>
        </div>
        {enabled ? (
          canDesign && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Değiştir
            </Button>
          )
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link to="/system/printing?tab=belgeler">Ayarlardan aç</Link>
          </Button>
        )}
      </div>
      {open && (
        <PickerDialog docType={docType} currentId={current?.id ?? null} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function PickerDialog({ docType, currentId, onClose }: { docType: string; currentId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: ["document-templates", "list", docType], queryFn: () => documentTemplateService.list(docType) });
  const [choice, setChoice] = useState<string | null>(currentId);
  const save = useMutation({
    mutationFn: () => documentTemplateService.setDefault(docType, choice),
    onSuccess: () => {
      toast.success("Varsayılan şablon kaydedildi.");
      void qc.invalidateQueries({ queryKey: ASSIGNMENTS_KEY });
      onClose();
    },
  });
  const rows: DocumentTemplateRow[] = listQ.data?.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Varsayılan şablon</DialogTitle>
          <DialogDescription>
            Seçilen şablon bundan sonra basılan belgelere uygulanır; önceden basılmış belgeler kendi tasarımıyla kalır.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-1 overflow-auto" role="listbox" aria-label="Şablonlar">
          <Choice label="Sistem (bugünkü tasarım)" hint="Değiştirilemez yerleşik tasarım" selected={choice === null} onSelect={() => setChoice(null)} />
          {listQ.isLoading && <div className="px-3 py-2 text-sm text-muted-foreground">Şablonlar yükleniyor…</div>}
          {!listQ.isLoading && rows.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Bu belge türü için henüz şablon yok.</div>
          )}
          {rows.map((t) => (
            <Choice
              key={t.id}
              label={t.name}
              hint={t.publishedVersion ? `Sürüm ${t.publishedVersion.versionNo} yayında` : "Yayında değil — önce yayınlanmalı"}
              disabled={!t.publishedVersionId}
              selected={choice === t.id}
              onSelect={() => setChoice(t.id)}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={save.isPending || choice === currentId} onClick={() => save.mutate()}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choice(p: { label: string; hint: string; selected: boolean; disabled?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={p.selected}
      disabled={p.disabled}
      onClick={p.onSelect}
      className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${p.selected ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{p.label}</span>
        <span className="block text-xs text-muted-foreground">{p.hint}</span>
      </span>
      {p.selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </button>
  );
}
