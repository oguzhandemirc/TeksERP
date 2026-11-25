// Yeni desen kartı — kimlik alanları (kod · ad) + sınıf (mekanizma · örgü); geri kalanı kart sayfasında.
// Doğrulamanın asıl kapısı sunucu (mükerrer kod/ad 409); `kind` gönderilmez, sunucu sınıftan türetir.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { weaveDesignApi } from "./service";
import { WeaveClassFields } from "./WeaveClassFields";
import type { WeaveClass } from "./weave-class";
import type { WeaveDesignInput } from "./types";

export { NATIVE_SELECT_CLASS } from "./WeaveClassFields";

/** `onSubmit` verilirse (seçicideki "Yeni") kaydı, bildirimi ve kapanışı çağıran yapar (ortak kayıt formu kancası). */
export function WeaveDesignCreateDialog({ onClose, onCreated, onSubmit }: { onClose: () => void; onCreated?: (id: string) => void; onSubmit?: (body: WeaveDesignInput) => Promise<void> }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [cls, setCls] = useState<WeaveClass>({ shedMechanism: "DOBBY", weaveStructure: null });
  const create = useMutation({
    mutationFn: async () => {
      const body = { code: code.trim(), name: name.trim(), ...cls };
      if (onSubmit) return onSubmit(body);
      const row = await weaveDesignApi.create(body);
      toast.success("Desen kartı oluşturuldu.");
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
      onClose();
      onCreated?.(row.id);
    },
  });
  const ready = code.trim().length > 0 && name.trim().length > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Yeni desen kartı</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wd-code">Desen kodu *</Label>
            <Input id="wd-code" value={code} maxLength={32} onChange={(e) => setCode(e.target.value)} placeholder="BALIK SIRTI DAR" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wd-name">Desen adı *</Label>
            <Input id="wd-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </div>
          <WeaveClassFields idPrefix="wd-new" value={cls} onChange={setCls} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>Oluştur</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
