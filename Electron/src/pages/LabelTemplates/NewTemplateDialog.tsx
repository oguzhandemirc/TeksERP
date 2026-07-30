import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import {
  LabelKind,
  labelKindLabels,
  labelTemplateService,
  type TemplateField,
} from "@/services/labelTemplateService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Yeni şablon (TEK HAVUZ) — oluşturunca doğrudan Etiket Stüdyosu'na gider;
 * boyut varyantı orada eklenir ("Yeni boyut": boş iskelet veya BAŞKA şablonun
 * varyantından kopya). Tür artık kimlik değil: önizleme örnek-verisinin bağlamı.
 */
/** "bound" = rulo/kartela etiketi (bağlama atanabilir); "standalone" = serbest
 *  (bakım/statik — atama yok, barkodsuz kaydedilebilir). */
type TemplateType = "bound" | "standalone";

export function NewTemplateDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [templateType, setTemplateType] = useState<TemplateType>("bound");
  const [kind, setKind] = useState<LabelKind>(LabelKind.ROLL_FINISHED);
  const isStandalone = templateType === "standalone";

  useEffect(() => {
    if (open) {
      setTemplateType("bound");
      setKind(LabelKind.ROLL_FINISHED);
      setName("");
    }
  }, [open]);

  const catalogQ = useQuery({
    queryKey: ["label-template-catalog", kind],
    queryFn: () => labelTemplateService.getCatalog(kind),
    enabled: open && !isStandalone,
  });

  const mut = useMutation({
    mutationFn: () => {
      // Serbest etiket: alan bağı yok, bağlamsız (kind null) oluşturulur.
      if (isStandalone) {
        return labelTemplateService.create({
          name: name.trim(),
          kind: null,
          fields: [],
          standalone: true,
        });
      }
      // fields = eski akış (dual-mode) emniyet düzeni — varyant eklenene kadar
      // şablon bu düzenle basılabilir kalır.
      const catalog = catalogQ.data?.data?.fields ?? [];
      const fields = catalog.map<TemplateField>((f, i) => ({
        key: f.key,
        label: f.defaultLabel,
        order: i + 1,
        isVisible: true,
      }));
      return labelTemplateService.create({ name: name.trim(), kind, fields, isDefault: false });
    },
    onSuccess: (res) => {
      toast.success("Şablon oluşturuldu — Stüdyoda boyut ekleyip tasarlayın.");
      void qc.invalidateQueries({ queryKey: ["label-templates"] });
      onOpenChange(false);
      navigate(`/definitions/label-templates/${res.data.id}`);
    },
  });

  const valid = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni Etiket Şablonu</DialogTitle>
          <DialogDescription>
            Şablon havuza eklenir; boyut ve kanvas tasarımı Stüdyoda yapılır.
            Mevcut bir tasarımın üstünden gitmek için Stüdyoda "Yeni boyut →
            kopyala" kullanın (başka şablondan da kopyalanabilir).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label="Şablon türü">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={templateType === "bound" ? "default" : "outline"}
                className="h-auto justify-start px-3 py-2 text-left"
                onClick={() => setTemplateType("bound")}
              >
                <span className="text-xs font-medium">Rulo / Kartela / Çuval etiketi</span>
              </Button>
              <Button
                type="button"
                variant={isStandalone ? "default" : "outline"}
                className="h-auto justify-start px-3 py-2 text-left"
                onClick={() => setTemplateType("standalone")}
              >
                <span className="text-xs font-medium">Serbest etiket</span>
              </Button>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {isStandalone
                ? "Bakım/statik etiket — bağlama atanamaz, barkod gerekmez; yalnız Serbest Baskı'da listelenir."
                : "Bağlama (rulo/kartela/çuval) atanabilir; okunabilir barkod gerektirir."}
            </p>
          </FormField>

          <FormField label="Ad" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isStandalone ? "örn. Yıkama Talimatı" : "örn. Müşteri X Özel"}
              autoFocus
            />
          </FormField>

          {!isStandalone && (
            <FormField label="Önizleme bağlamı (örnek verinin sözlüğü)">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as LabelKind)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {(Object.keys(labelKindLabels) as LabelKind[]).map((k) => (
                  <option key={k} value={k}>
                    {labelKindLabels[k]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Kimlik değildir — şablon her bağlama atanabilir; bağlam-dışı alanlar baskıda boş kalır.
              </p>
            </FormField>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button type="button" disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Oluşturuluyor..." : "Oluştur ve Stüdyoda Aç"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
