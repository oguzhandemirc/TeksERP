import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { DocumentStyleControls } from "@/pages/GeneralSettings/DocumentStyleControls";
import { DocumentAdvancedControls } from "@/pages/GeneralSettings/DocumentAdvancedControls";
import { freeDocumentService, type FreeDocument } from "@/services/freeDocumentService";
import type { DocumentConfig, DocDef } from "@/services/documentConfig";

// Serbest belgede tablo/dil yok — yalnız stil/logo + damga/blok kontrolleri.
const FREE_DEF: DocDef = {
  key: "free",
  label: "Serbest Belge",
  defaultTitle: "",
  defaultSignatures: [],
  sections: [],
};

export const FREE_DOCS_QUERY_KEY = ["free-documents"];

export function FreeDocumentEditor({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Düzenleme için tam belge; yoksa yeni. */
  initial?: FreeDocument | null;
}) {
  const qc = useQueryClient();
  const isEdit = Boolean(initial);
  const [title, setTitle] = useState("");
  const [recipient, setRecipient] = useState("");
  const [body, setBody] = useState("");
  const [config, setConfig] = useState<DocumentConfig>({});
  const [showStyle, setShowStyle] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setRecipient(initial?.recipient ?? "");
    setBody(initial?.body ?? "");
    setConfig(initial?.config ?? {});
    setShowStyle(false);
  }, [open, initial]);

  const patch = (next: Partial<DocumentConfig>) => setConfig((c) => ({ ...c, ...next }));

  const mut = useMutation({
    mutationFn: () => {
      const payload = { title: title.trim(), recipient: recipient.trim() || null, body, config };
      return isEdit ? freeDocumentService.update(initial!.id, payload) : freeDocumentService.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Belge güncellendi." : "Serbest belge oluşturuldu.");
      void qc.invalidateQueries({ queryKey: FREE_DOCS_QUERY_KEY });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Serbest Belgeyi Düzenle" : "Yeni Serbest Belge"}</DialogTitle>
          <DialogDescription>
            Sisteme bağlı olmayan serbest belge (üst yazı, tutanak, dekont, duyuru…). Antet, logo ve
            damgalar Belge Şablonları stil katmanından gelir.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {isEdit && (
            <div className="text-xs text-muted-foreground">
              Belge No: <span className="font-mono">{initial?.documentNo}</span>
            </div>
          )}
          <FormField label="Başlık" htmlFor="fd-title" required>
            <Input id="fd-title" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Örn. Teslim Tutanağı" />
          </FormField>
          <FormField label="Muhatap (Sayın …)" htmlFor="fd-recipient" hint="Opsiyonel — boşsa basılmaz">
            <Input id="fd-recipient" value={recipient} maxLength={200} onChange={(e) => setRecipient(e.target.value)} placeholder="Örn. Örnek Tekstil A.Ş." />
          </FormField>
          <FormField label="Gövde Metni" htmlFor="fd-body" required>
            <textarea
              id="fd-body"
              rows={10}
              value={body}
              maxLength={20000}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Belge gövdesi — satır sonları korunur."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </FormField>

          <button
            type="button"
            onClick={() => setShowStyle((s) => !s)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {showStyle ? "Görünüm ayarlarını gizle" : "Görünüm ayarları (stil, logo, damga, blok)…"}
          </button>
          {showStyle && (
            <div className="space-y-3 border-t pt-3">
              <DocumentStyleControls cfg={config} disabled={mut.isPending} patch={patch} />
              <DocumentAdvancedControls def={FREE_DEF} cfg={config} disabled={mut.isPending} patch={patch} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button type="button" disabled={!title.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
