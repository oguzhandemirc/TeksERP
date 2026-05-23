import { useEffect, useState } from "react";
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
  defaultKind: LabelKind;
}

export function NewTemplateDialog({ open, onOpenChange, defaultKind }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LabelKind>(defaultKind);
  const [copyFrom, setCopyFrom] = useState<string>("");

  useEffect(() => {
    if (open) {
      setKind(defaultKind);
      setName("");
      setCopyFrom("");
    }
  }, [open, defaultKind]);

  const templatesQ = useQuery({
    queryKey: ["label-templates", kind],
    queryFn: () => labelTemplateService.list(kind),
    enabled: open,
  });

  const catalogQ = useQuery({
    queryKey: ["label-template-catalog", kind],
    queryFn: () => labelTemplateService.getCatalog(kind),
    enabled: open,
  });

  const mut = useMutation({
    mutationFn: () => {
      const sourceFields = (() => {
        if (copyFrom) {
          const src = templatesQ.data?.data?.find((t) => t.id === copyFrom);
          if (src) return src.fields;
        }
        const catalog = catalogQ.data?.data?.fields ?? [];
        return catalog.map<TemplateField>((f, i) => ({
          key: f.key,
          label: f.defaultLabel,
          order: i + 1,
          isVisible: Boolean(f.required) || true,
        }));
      })();
      return labelTemplateService.create({
        name: name.trim(),
        kind,
        fields: sourceFields,
        isDefault: false,
      });
    },
    onSuccess: () => {
      toast.success("Şablon oluşturuldu.");
      void qc.invalidateQueries({ queryKey: ["label-templates"] });
      onOpenChange(false);
    },
  });

  const valid = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni Etiket Şablonu</DialogTitle>
          <DialogDescription>
            Sıfırdan veya mevcut bir şablondan kopyala.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label="Tür" required>
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
          </FormField>

          <FormField label="Ad" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Müşteri X Özel"
              autoFocus
            />
          </FormField>

          <FormField label="Kaynak">
            <select
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Sıfırdan (catalog default'ları)</option>
              {(templatesQ.data?.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  Kopyala: {t.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            type="button"
            disabled={!valid || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Oluşturuluyor..." : "Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
