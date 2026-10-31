// Yeni desen kartı — yalnız kimlik alanları (kod · ad · örgü türü); geri kalanı kart sayfasında.
// Doğrulamanın asıl kapısı sunucu (mükerrer kod/ad 409); panel `VarChar` sınırlarını aynalar.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { weaveDesignApi } from "./service";
import { WEAVE_DESIGN_KINDS, WEAVE_KIND_LABEL, type WeaveDesignKind } from "./types";

export const NATIVE_SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function WeaveDesignCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WeaveDesignKind>("DOBBY");
  const create = useMutation({
    mutationFn: () => weaveDesignApi.create({ code: code.trim(), name: name.trim(), kind }),
    onSuccess: (row) => {
      toast.success("Desen kartı oluşturuldu.");
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
      onClose();
      onCreated(row.id);
    },
  });
  const ready = code.trim().length > 0 && name.trim().length > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Yeni desen kartı</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wd-code">Desen kodu *</Label>
            <Input id="wd-code" value={code} maxLength={32} onChange={(e) => setCode(e.target.value)} placeholder="BALIK SIRTI DAR" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wd-name">Desen adı *</Label>
            <Input id="wd-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wd-kind">Örgü türü *</Label>
            <select id="wd-kind" className={NATIVE_SELECT_CLASS} value={kind} onChange={(e) => setKind(e.target.value as WeaveDesignKind)}>
              {WEAVE_DESIGN_KINDS.map((k) => <option key={k} value={k}>{WEAVE_KIND_LABEL[k]}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>Oluştur</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
