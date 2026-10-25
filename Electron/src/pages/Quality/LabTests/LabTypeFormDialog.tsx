// Lab test türü ekle/düzenle — kod, ad, yöntem, sonuç biçimi, birim, varsayılan sınır.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labTestTypeService, type LabResultKind, type LabTestType } from "./service";
import { KIND_LABEL, parseDecimalInput } from "./labTestRules";

interface Props { initial: LabTestType | null; onClose: () => void }
const txt = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)).replace(".", ","));

export function LabTypeFormDialog({ initial, onClose }: Props) {
  const qc = useQueryClient();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [method, setMethod] = useState(initial?.method ?? "");
  const [kind, setKind] = useState<LabResultKind>(initial?.resultKind ?? "NUMERIC");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [specMin, setSpecMin] = useState(txt(initial?.specMin));
  const [specMax, setSpecMax] = useState(txt(initial?.specMax));
  const a = parseDecimalInput(specMin), b = parseDecimalInput(specMax);
  const save = useMutation({
    mutationFn: () => {
      const body = { code: code.trim(), name: name.trim(), method: method.trim() || null, resultKind: kind, unit: kind === "NUMERIC" ? unit.trim() || null : null,
        specMin: kind === "PASS_FAIL" ? null : a, specMax: kind === "PASS_FAIL" ? null : b, ...(initial ? { isActive: initial.isActive } : {}) };
      return initial ? labTestTypeService.update(initial.id, body) : labTestTypeService.create(body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["lab-test-types"] }); toast.success("Test türü kaydedildi."); onClose(); },
  });
  const invalid = !code.trim() || !name.trim() || Number.isNaN(a) || Number.isNaN(b);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Test türünü düzenle" : "Yeni test türü"}</DialogTitle>
          <DialogDescription>Varsayılan sınır her sonuçta kopyalanır; müşteri spesifikasyonu sonuç girilirken ayrıca verilebilir.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="lt-code">Kod</Label><Input id="lt-code" maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="lt-name">Ad</Label><Input id="lt-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="lt-method">Yöntem / standart</Label><Input id="lt-method" maxLength={64} placeholder="Ör. ISO 105-C06" value={method} onChange={(e) => setMethod(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Sonuç biçimi</Label>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(KIND_LABEL) as LabResultKind[]).map((k) => (
                <Button key={k} type="button" size="sm" variant={kind === k ? "default" : "outline"} disabled={Boolean(initial)} onClick={() => setKind(k)}>{KIND_LABEL[k]}</Button>
              ))}
            </div>
          </div>
          {kind === "NUMERIC" && <div className="space-y-1"><Label htmlFor="lt-unit">Birim</Label><Input id="lt-unit" maxLength={16} placeholder="g/m², cm, %" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>}
          {kind !== "PASS_FAIL" && (
            <div className="space-y-1">
              <Label>Varsayılan sınır</Label>
              <div className="flex gap-2">
                <Input aria-label="Alt sınır" placeholder="Alt" inputMode="decimal" value={specMin} onChange={(e) => setSpecMin(e.target.value)} />
                <Input aria-label="Üst sınır" placeholder="Üst" inputMode="decimal" value={specMax} onChange={(e) => setSpecMax(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
