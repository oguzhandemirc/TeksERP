// =============================================================================
// Etiket Stüdyosu — boyut varyantı sekmeleri + "Yeni boyut (kopyala)" diyaloğu
// =============================================================================
// Kullanıcı modeli: şablon = tasarım; her boyut ELLE teyitli ayrı varyant.
// Yeni varyant mevcut birinden KOPYALANIR (otomatik ölçekleme YOK) veya boş
// iskeletle başlar. Baskıda medyaya ±1mm uyan varyant; yoksa birincil (★).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { labelTemplateService, type LabelTemplateVariant } from "@/services/labelTemplateService";
import { loadAllForPicker } from "@/lib/picker-loader";
import { labelFormatProfileService } from "@/pages/LabelFormatProfiles/service";
import type { LabelFormatProfile } from "@/pages/LabelFormatProfiles/types";
import { starterLayout } from "./canvas-model";

interface Props {
  templateId: string;
  variants: LabelTemplateVariant[];
  activeId: string | null;
  onSelect: (id: string) => void;
  dirty: boolean;
}

export function VariantTabs({ templateId, variants, activeId, onSelect, dirty }: Props) {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [deleting, setDeleting] = useState<LabelTemplateVariant | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["label-template-variants", templateId] });

  const primaryMut = useMutation({
    mutationFn: (id: string) => labelTemplateService.setPrimaryVariant(id),
    onSuccess: () => { toast.success("Birincil varyant güncellendi."); invalidate(); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => labelTemplateService.deleteVariant(id),
    onSuccess: () => { toast.success("Varyant silindi."); setDeleting(null); invalidate(); },
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {variants.map((v) => (
        <div
          key={v.id}
          className={cn(
            "flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
            activeId === v.id ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent",
          )}
        >
          <button type="button" onClick={() => onSelect(v.id)} className="flex items-center gap-1"
            title={dirty && activeId !== v.id ? "Dikkat: kaydedilmemiş değişiklik var" : v.name}>
            {v.isPrimary && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
            {v.widthMm}×{v.heightMm}
          </button>
          {!v.isPrimary && (
            <button type="button" className="text-muted-foreground hover:text-amber-500"
              title="Birincil yap (medya eşleşmeyince bu basılır)"
              onClick={() => primaryMut.mutate(v.id)}>
              <Star className="h-3 w-3" />
            </button>
          )}
          {(!v.isPrimary || variants.length === 1) && (
            <button type="button" className="text-muted-foreground hover:text-destructive"
              title={variants.length === 1 ? "Son varyantı sil (şablon eski akış düzenine döner)" : "Varyantı sil"}
              onClick={() => setDeleting(v)}>
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setNewOpen(true)}>
        <Plus className="h-3 w-3" /> Yeni boyut
      </Button>

      <NewVariantDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        templateId={templateId}
        variants={variants}
        onCreated={(v) => { invalidate(); onSelect(v.id); }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Varyant silinsin mi?"
        description={
          deleting && variants.length === 1
            ? `"${deleting.name}" şablonun SON varyantı — silinirse şablon kanvas düzenini kaybeder ve eski akış (satır-listesi) düzeninde basılır.`
            : `"${deleting?.name ?? ""}" boyut varyantı silinecek. Bu boyuttaki yazıcılar birincil varyanta düşer.`
        }
        confirmLabel="Sil"
        destructive
        isPending={deleteMut.isPending}
        onConfirm={() => { if (deleting) deleteMut.mutate(deleting.id); }}
      />
    </div>
  );
}

function NewVariantDialog({ open, onOpenChange, templateId, variants, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templateId: string;
  variants: LabelTemplateVariant[];
  onCreated: (v: LabelTemplateVariant) => void;
}) {
  const [widthMm, setWidthMm] = useState(100);
  const [heightMm, setHeightMm] = useState(60);
  const [source, setSource] = useState<string>("blank"); // "blank" | variantId

  const profilesQ = useQuery({
    queryKey: ["label-format-profiles", "picker"],
    queryFn: () => loadAllForPicker(labelFormatProfileService).then((r) => r.data),
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: () =>
      labelTemplateService.createVariant(templateId, {
        widthMm,
        heightMm,
        ...(source === "blank"
          ? { elements: starterLayout({ widthMm, heightMm }) }
          : { copyFromVariantId: source }),
      }),
    onSuccess: (v) => {
      toast.success(
        source === "blank"
          ? "Varyant oluşturuldu — iskelet düzeni elle düzenleyin."
          : "Varyant kopyalandı — yerleşimi yeni boyuta göre ELLE düzeltin (otomatik ölçekleme yok).",
      );
      onOpenChange(false);
      onCreated(v);
    },
  });

  const applyProfile = (p: LabelFormatProfile) => {
    setWidthMm(Number(p.widthMm));
    setHeightMm(Number(p.heightMm));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Yeni Boyut Varyantı</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Boyut profili (referans — ön-doldurur, bağlamaz)</Label>
            <Select onValueChange={(id) => {
              const p = (profilesQ.data ?? []).find((x) => x.id === id);
              if (p) applyProfile(p);
            }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Profilden ölçü al…" /></SelectTrigger>
              <SelectContent>
                {(profilesQ.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name} ({Number(p.widthMm)}×{Number(p.heightMm)} mm)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Genişlik (mm)</Label>
              <Input type="number" className="h-8" value={widthMm} min={10} max={500}
                onChange={(e) => setWidthMm(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Yükseklik (mm)</Label>
              <Input type="number" className="h-8" value={heightMm} min={10} max={500}
                onChange={(e) => setHeightMm(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Başlangıç yerleşimi</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="blank" className="text-xs">Boş iskelet (QR + ürün + barkod)</SelectItem>
                {variants.map((v) => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">
                    "{v.name}" üzerinden kopyala ({v.widthMm}×{v.heightMm})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {source !== "blank" && (
              <p className="text-[10px] text-amber-600 dark:text-amber-500">
                Kopyalanan yerleşim OTOMATİK ölçeklenmez — yeni boyuta göre elle düzeltip teyit edin.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button type="button" disabled={createMut.isPending || widthMm < 10 || heightMm < 10}
            onClick={() => createMut.mutate()}>
            {createMut.isPending ? "Oluşturuluyor…" : "Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
