// Hazır listeden tür ekle — önizleme her satırı ve "zaten var" durumunu gösterir, satır satır seçilir.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { apiErrorText } from "@/lib/api-error";
import { labTestTypeService } from "./service";
import { KIND_LABEL } from "./labTestRules";

export function LabPresetDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const q = useQuery({ queryKey: ["lab-test-types", "presets"], queryFn: labTestTypeService.presets });
  const save = useMutation({
    mutationFn: () => labTestTypeService.addPresets([...picked]),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["lab-test-types"] }); toast.success(`${r.created} test türü eklendi.`); onClose(); },
  });
  const toggle = (code: string) => setPicked((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Hazır listeden ekle</DialogTitle>
          <DialogDescription>Sık kullanılan tekstil testleri. Katalogda olanlar seçilemez.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Yükleniyor…</p> : q.isError ? <p className="text-sm text-destructive">{apiErrorText(q.error, "Hazır liste okunamadı.")}</p> : (
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            {(q.data ?? []).map((p) => (
              <label key={p.code} className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-0">
                <Checkbox disabled={p.exists} checked={p.exists || picked.has(p.code)} onCheckedChange={() => toggle(p.code)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">{[p.code, p.method, KIND_LABEL[p.resultKind], p.unit].filter(Boolean).join(" · ")}</span>
                </span>
                {p.exists && <span className="text-xs text-muted-foreground">katalogda</span>}
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={picked.size === 0 || save.isPending} onClick={() => save.mutate()}>{`Ekle (${picked.size})`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
