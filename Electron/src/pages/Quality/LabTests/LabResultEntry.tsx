// Sonuç girişi (yalnız taslak) — tür düğmeyle seçilir (açılır liste yok); sınır boşsa türün varsayılanı
// geçerli, doluysa müşteri spesifikasyonu olarak sonuca yazılır. Hüküm sınırdan otomatik; sınırsızda elle.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { LabResultInput, LabTestType, LabVerdict } from "./service";
import { KIND_LABEL, parseDecimalInput, specRangeText } from "./labTestRules";

interface Props { types: LabTestType[]; enteredTypeIds: Set<string>; busy: boolean; onSave: (input: LabResultInput) => void }

export function LabResultEntry({ types, enteredTypeIds, busy, onSave }: Props) {
  const [typeId, setTypeId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [verdict, setVerdict] = useState<LabVerdict | null>(null);
  const [specMin, setSpecMin] = useState("");
  const [specMax, setSpecMax] = useState("");
  const [note, setNote] = useState("");
  const type = types.find((t) => t.id === typeId);
  const reset = (id: string | null) => { setTypeId(id); setValue(""); setVerdict(null); setSpecMin(""); setSpecMax(""); setNote(""); };

  const v = parseDecimalInput(value), a = parseDecimalInput(specMin), b = parseDecimalInput(specMax);
  const hasSpec = a !== null || b !== null || (type?.specMin ?? null) !== null || (type?.specMax ?? null) !== null;
  const needsVerdict = type?.resultKind === "PASS_FAIL" || !hasSpec;
  const invalid = !type || [v, a, b].some((x) => Number.isNaN(x)) || (type.resultKind !== "PASS_FAIL" && v === null) || (needsVerdict && !verdict);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="text-sm font-medium">Sonuç ekle / güncelle</div>
      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <button key={t.id} type="button" onClick={() => reset(t.id)}
            className={cn("rounded-md border px-2.5 py-1 text-xs", t.id === typeId && "border-primary bg-primary/10", enteredTypeIds.has(t.id) && "text-muted-foreground")}>
            {t.name}{enteredTypeIds.has(t.id) ? " ✓" : ""}
          </button>
        ))}
        {types.length === 0 && <p className="text-xs text-muted-foreground">Etkin test türü yok — “Test türleri” sekmesinden ekleyin.</p>}
      </div>
      {type && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {KIND_LABEL[type.resultKind]}{type.unit ? ` · ${type.unit}` : ""}{type.resultKind === "SCALE" ? ` · 1–${type.scaleMax ?? 5}, yarım adım (4,5 = “4-5”)` : ""}
            {" · Tür sınırı: "}{specRangeText(type.specMin, type.specMax, type.resultKind) ?? "yok"}
          </p>
          {type.resultKind !== "PASS_FAIL" && (
            <div className="space-y-1"><Label htmlFor="lab-value">Değer</Label><Input id="lab-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></div>
          )}
          {type.resultKind !== "PASS_FAIL" && (
            <div className="space-y-1">
              <Label>Müşteri spesifikasyonu (isteğe bağlı)</Label>
              <div className="flex gap-2">
                <Input aria-label="Alt sınır" placeholder="Alt" inputMode="decimal" value={specMin} onChange={(e) => setSpecMin(e.target.value)} />
                <Input aria-label="Üst sınır" placeholder="Üst" inputMode="decimal" value={specMax} onChange={(e) => setSpecMax(e.target.value)} />
              </div>
            </div>
          )}
          {needsVerdict && (
            <div className="space-y-1">
              <Label>Hüküm</Label>
              <div className="flex gap-2">
                {(["PASS", "FAIL"] as const).map((x) => (
                  <Button key={x} type="button" size="sm" variant={verdict === x ? (x === "PASS" ? "default" : "destructive") : "outline"} onClick={() => setVerdict(x)}>
                    {x === "PASS" ? "Geçti" : "Kaldı"}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="lab-rnote">Not</Label><Input id="lab-rnote" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="sm:col-span-2">
            <Button disabled={invalid || busy} onClick={() => onSave({
              testTypeId: type.id, value: type.resultKind === "PASS_FAIL" ? null : v,
              ...(needsVerdict ? { verdict } : {}), ...(a !== null ? { specMin: a } : {}), ...(b !== null ? { specMax: b } : {}), note: note.trim() || null,
            })}>Sonucu kaydet</Button>
          </div>
        </div>
      )}
    </div>
  );
}
