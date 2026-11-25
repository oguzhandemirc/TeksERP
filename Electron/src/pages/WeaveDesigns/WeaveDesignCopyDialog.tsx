// Desen kartını kopyala — yalnız yeni kod + ad sorulur; gerisi kaynaktan tek istekte kopyalanır
// (`buildCopyPayload`). Mükerrer kod/ad sunucuda 409 ("zaten var") → apiClient'in tek toast'ı.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { weaveDesignApi } from "./service";
import type { WeaveDesign } from "./types";
import { buildCopyPayload } from "./weave-copy";
import { SHED_MECHANISM_LABEL, resolveWeaveClass } from "./weave-class";

export function WeaveDesignCopyDialog({ source, onClose, onCreated }: { source: WeaveDesign; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => weaveDesignApi.create(buildCopyPayload(source, { code, name })),
    onSuccess: (row) => {
      toast.success(`${source.code} kopyalandı: ${row.code}`);
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
      onClose();
      onCreated(row.id);
    },
  });
  const ready = code.trim().length > 0 && name.trim().length > 0;
  const hasGrid = resolveWeaveClass(source).shedMechanism === "DOBBY" && (source.liftPlan?.length ?? 0) > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{source.code} kartından örnek al — yeni desen kartı</DialogTitle>
          <DialogDescription>
            Yeni kart bu kartın yapı bilgilerini (mekanizma: {SHED_MECHANISM_LABEL[resolveWeaveClass(source).shedMechanism]}){hasGrid ? ", armür ızgarasını" : ""} ve
            notlarını alır; sonra yalnız farkı değiştirirsiniz. Tezgâh dosya adı boş başlar; desen görseli ve bağlı kumaşlar kopyalanmaz.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wd-copy-code">Yeni desen kodu *</Label>
            <Input id="wd-copy-code" autoFocus value={code} maxLength={32} onChange={(e) => setCode(e.target.value)} placeholder={`ör. ${source.code}B`} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wd-copy-name">Yeni desen adı *</Label>
            <Input id="wd-copy-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={`ör. ${source.name} 2`} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>Yeni kartı oluştur</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
