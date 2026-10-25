// Taşıma + alıcı kişi alanları (backend PrepareSchema/PatchSchema aynası; tavanlar aynı).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { EIrsaliyeFields, EIrsaliyeRecord } from "./types";

type Key = keyof EIrsaliyeFields;
export type FieldDraft = Record<Key, string>;

const FIELDS: ReadonlyArray<{ key: Key; label: string; max: number; hint?: string; inputMode?: "numeric" }> = [
  { key: "licensePlate", label: "Araç plakası", max: 32 },
  { key: "trailerPlate", label: "Dorse plakası", max: 32 },
  { key: "driverFirstName", label: "Şoför adı", max: 100 },
  { key: "driverFamilyName", label: "Şoför soyadı", max: 100 },
  { key: "driverNationalId", label: "Şoför TCKN", max: 11, inputMode: "numeric" },
  { key: "carrierName", label: "Taşıyıcı unvanı", max: 200, hint: "Kendi aracınızsa boş bırakın" },
  { key: "carrierTaxId", label: "Taşıyıcı VKN/TCKN", max: 11, inputMode: "numeric" },
  { key: "recipientFirstName", label: "Müşteri kişi adı", max: 100, hint: "Yalnız TCKN'li (şahıs) alıcıda" },
  { key: "recipientFamilyName", label: "Müşteri kişi soyadı", max: 100 },
];

export const emptyFields: FieldDraft = Object.fromEntries(FIELDS.map((f) => [f.key, ""])) as FieldDraft;

export function fieldsFromRecord(r: EIrsaliyeRecord): FieldDraft {
  return Object.fromEntries(FIELDS.map((f) => [f.key, r[f.key] ?? ""])) as FieldDraft;
}

/** Düzenlemede boş = temizle (null); hazırlıkta boş alan gönderilmez → sunucu önerisi kalır. */
export function payloadOf(d: FieldDraft, clearEmpty: boolean): EIrsaliyeFields {
  const out: EIrsaliyeFields = {};
  for (const f of FIELDS) {
    const v = d[f.key].trim();
    if (v) out[f.key] = v;
    else if (clearEmpty) out[f.key] = null;
  }
  return out;
}

export function EIrsaliyeFieldsForm({
  draft,
  onChange,
  invalidField,
}: {
  draft: FieldDraft;
  onChange: (d: FieldDraft) => void;
  invalidField: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`eirs-${f.key}`}>{f.label}</Label>
          <Input
            id={`eirs-${f.key}`}
            value={draft[f.key]}
            maxLength={f.max}
            inputMode={f.inputMode}
            autoComplete="off"
            aria-invalid={invalidField === f.key}
            className={cn(invalidField === f.key && "border-destructive")}
            onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })}
          />
          {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
    </div>
  );
}
