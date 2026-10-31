// Yapı sekmesi: desen kimliği + tezgâh bilgileri (PATCH yalnız değişen alanları değil formun tamamını
// gönderir; sunucu boşu NULL'a çevirir) + seçili kumaşın çözgü katmanları ve tutarlılık uyarıları.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NATIVE_SELECT_CLASS } from "../WeaveDesignCreateDialog";
import { weaveDesignApi } from "../service";
import { WEAVE_DESIGN_KINDS, WEAVE_KIND_LABEL, type DesignFabric, type WeaveDesign, type WeaveDesignKind } from "../types";
import { WarpLayersSection } from "./WarpLayersSection";

type Form = Record<"code" | "name" | "familyLabel" | "frameCount" | "repeatCm" | "loomFileName" | "lenoSetup" | "notes", string> & { kind: WeaveDesignKind };

const TEXT_FIELDS: Array<{ key: keyof Omit<Form, "kind" | "notes">; label: string; max: number; mode?: "numeric" | "decimal" }> = [
  { key: "code", label: "Desen kodu *", max: 32 },
  { key: "name", label: "Desen adı *", max: 100 },
  { key: "familyLabel", label: "Aile etiketi (TERGAL-DÖNER, BALIK…)", max: 40 },
  { key: "frameCount", label: "Çerçeve sayısı (1–32)", max: 2, mode: "numeric" },
  { key: "repeatCm", label: "Desen boyu (cm)", max: 10, mode: "decimal" },
  { key: "loomFileName", label: "Tezgâh desen dosyası (.DOP)", max: 64 },
  { key: "lenoSetup", label: "Döner kurulumu", max: 100 },
];

function toForm(d: WeaveDesign): Form {
  return {
    code: d.code, name: d.name, kind: d.kind, familyLabel: d.familyLabel ?? "", frameCount: d.frameCount?.toString() ?? "",
    repeatCm: d.repeatCm ?? "", loomFileName: d.loomFileName ?? "", lenoSetup: d.lenoSetup ?? "", notes: d.notes ?? "",
  };
}

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

export function StructureTab({ design, fabric, canWrite }: { design: WeaveDesign; fabric: DesignFabric | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(design));
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () => weaveDesignApi.update(design.id, {
      code: form.code.trim(), name: form.name.trim(), kind: form.kind, familyLabel: orNull(form.familyLabel),
      frameCount: form.frameCount.trim() === "" ? null : Number(form.frameCount), repeatCm: orNull(form.repeatCm.replace(",", ".")),
      loomFileName: orNull(form.loomFileName), lenoSetup: orNull(form.lenoSetup), notes: orNull(form.notes),
    }),
    onSuccess: () => {
      toast.success("Desen kartı güncellendi.");
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
    },
  });
  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEXT_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`wd-${f.key}`}>{f.label}</Label>
            <Input id={`wd-${f.key}`} value={form[f.key]} maxLength={f.max} inputMode={f.mode} disabled={!canWrite} onChange={(e) => set(f.key, e.target.value)} />
          </div>
        ))}
        <div className="space-y-1.5">
          <Label htmlFor="wd-kind-edit">Örgü türü *</Label>
          <select id="wd-kind-edit" className={NATIVE_SELECT_CLASS} value={form.kind} disabled={!canWrite} onChange={(e) => set("kind", e.target.value)}>
            {WEAVE_DESIGN_KINDS.map((k) => <option key={k} value={k}>{WEAVE_KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="wd-notes">Not</Label>
          <Textarea id="wd-notes" value={form.notes} maxLength={500} disabled={!canWrite} onChange={(e) => set("notes", e.target.value)} />
        </div>
        {canWrite && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Button disabled={save.isPending || !form.code.trim() || !form.name.trim()} onClick={() => save.mutate()}>Kaydet</Button>
          </div>
        )}
      </section>
      {fabric && <WarpLayersSection fabric={fabric} canWrite={canWrite} />}
    </div>
  );
}
