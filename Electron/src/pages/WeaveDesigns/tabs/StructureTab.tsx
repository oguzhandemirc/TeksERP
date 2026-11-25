// Yapı sekmesi: desen kimliği + sınıf (mekanizma · örgü) + mekanizmaya ait tezgâh bilgileri. Alanlar
// mekanizmaya göre: Armür → çerçeve/.DOP/tahar · Jakar → desen dosyası, kanca, rapor en×boy, görsel ·
// Eksantrik → örgü + tahar. Gizli alan GÖNDERİLMEZ (saklı değer silinmez; sunucu zaten Armür dışı ızgarayı,
// Jakar dışı kancayı reddeder). Boş gönderilen görünür alanı sunucu NULL'a çevirir.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InfoPopover } from "@/components/ui/info-popover";
import { weaveDesignApi } from "../service";
import type { DesignFabric, WeaveDesign, WeaveDesignInput } from "../types";
import { resolveWeaveClass, type ShedMechanism, type WeaveClass } from "../weave-class";
import { WeaveClassFields } from "../WeaveClassFields";
import { DrawingInFields, drawingInApplies } from "../DrawingInFields";
import { LOOM_FILE_NAME_WARNING, loomFileNameTooLong } from "../loom-file-name";
import type { DrawingInType } from "@/components/weave/weave-drawing-in";
import { DesignImageSection } from "./DesignImageSection";
import { WarpLayersSection } from "./WarpLayersSection";
import { decimalToFormText } from "@/lib/decimal-form-text";

type TextKey = "code" | "name" | "familyLabel" | "frameCount" | "repeatCm" | "repeatWidthCm" | "hookCount" | "loomFileName" | "lenoSetup" | "drawingInNote" | "notes";
type Form = Record<TextKey, string> & WeaveClass & { drawingInType: DrawingInType | null };

interface FieldDef { key: TextKey; label: string; max: number; mode?: "numeric" | "decimal"; info?: string; show: (m: ShedMechanism, f: Form) => boolean }

const ALL = () => true;
/** FIELDS'in ilk üçü kimlik alanları (her mekanizmada). */
const IDENTITY_COUNT = 3;
const FIELDS: FieldDef[] = [
  { key: "code", label: "Desen kodu *", max: 32, show: ALL },
  { key: "name", label: "Desen adı *", max: 100, show: ALL },
  { key: "familyLabel", label: "Aile etiketi (TERGAL-DÖNER, BALIK…)", max: 40, show: ALL },
  { key: "frameCount", label: "Çerçeve sayısı (1–32)", max: 2, mode: "numeric", show: (m) => m === "DOBBY" },
  { key: "repeatCm", label: "Desen boyu (cm)", max: 10, mode: "decimal", show: (m) => m !== "JACQUARD" },
  { key: "loomFileName", label: "Tezgâh desen dosyası (.DOP)", max: 64, show: (m) => m === "DOBBY" },
  { key: "loomFileName", label: "Desen dosyası", max: 64, info: "Jakar makinesine yüklenen desen dosyasının adı (ör. GUL-01.JC5). Desen bu dosyadan dokunur.", show: (m) => m === "JACQUARD" },
  { key: "hookCount", label: "Kanca sayısı", max: 5, mode: "numeric", info: "Jakar makinesinin kullandığı kanca (platin) sayısı; her kanca bir ya da birkaç çözgü telini kaldırır. 1–30.000.", show: (m) => m === "JACQUARD" },
  { key: "repeatWidthCm", label: "Rapor eni (cm)", max: 10, mode: "decimal", info: "Desenin enine bir kez tekrar ettiği genişlik.", show: (m) => m === "JACQUARD" },
  { key: "repeatCm", label: "Rapor boyu (cm)", max: 10, mode: "decimal", info: "Desenin boyuna bir kez tekrar ettiği uzunluk.", show: (m) => m === "JACQUARD" },
  { key: "lenoSetup", label: "Döner kurulumu", max: 100, show: (_m, f) => f.weaveStructure === "LENO" },
];

function toForm(d: WeaveDesign): Form {
  return {
    code: d.code, name: d.name, ...resolveWeaveClass(d), familyLabel: d.familyLabel ?? "", frameCount: d.frameCount?.toString() ?? "",
    repeatCm: decimalToFormText(d.repeatCm), repeatWidthCm: decimalToFormText(d.repeatWidthCm ?? null), hookCount: d.hookCount?.toString() ?? "",
    loomFileName: d.loomFileName ?? "", lenoSetup: d.lenoSetup ?? "", drawingInNote: d.drawingInNote ?? "", notes: d.notes ?? "",
    drawingInType: d.drawingInType ?? null,
  };
}

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
const decOrNull = (v: string) => orNull(v.replace(",", "."));
const intOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

/** PATCH gövdesi — yalnız seçili mekanizmada görünen alanlar; `kind` sunucuda sınıftan türer. */
export function structurePayload(f: Form): WeaveDesignInput {
  const m = f.shedMechanism;
  const body: WeaveDesignInput = {
    code: f.code.trim(), name: f.name.trim(), shedMechanism: m, weaveStructure: f.weaveStructure,
    familyLabel: orNull(f.familyLabel), repeatCm: decOrNull(f.repeatCm), notes: orNull(f.notes),
  };
  if (m === "DOBBY") Object.assign(body, { frameCount: intOrNull(f.frameCount), loomFileName: orNull(f.loomFileName) });
  if (drawingInApplies(m)) Object.assign(body, { drawingInType: f.drawingInType, drawingInNote: orNull(f.drawingInNote) });
  if (m === "JACQUARD") Object.assign(body, { loomFileName: orNull(f.loomFileName), hookCount: intOrNull(f.hookCount), repeatWidthCm: decOrNull(f.repeatWidthCm) });
  if (f.weaveStructure === "LENO") body.lenoSetup = orNull(f.lenoSetup);
  return body;
}

export function StructureTab({ design, fabric, canWrite }: { design: WeaveDesign; fabric: DesignFabric | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(design));
  const set = (k: TextKey, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () => weaveDesignApi.update(design.id, structurePayload(form)),
    onSuccess: () => {
      toast.success("Desen kartı güncellendi.");
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
    },
  });
  const m = form.shedMechanism;
  const savedMech = resolveWeaveClass(design).shedMechanism;
  const renderField = (f: FieldDef) => (
    <div key={`${f.key}-${f.label}`} className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={`wd-${f.key}`}>{f.label}</Label>
        {f.info && <InfoPopover desc={f.info} label={`${f.label} açıklaması`} />}
      </div>
      <Input id={`wd-${f.key}`} value={form[f.key]} maxLength={f.max} inputMode={f.mode} disabled={!canWrite} onChange={(e) => set(f.key, e.target.value)} />
      {f.key === "loomFileName" && loomFileNameTooLong(form.loomFileName) && <p className="text-xs text-amber-700 dark:text-amber-400">{LOOM_FILE_NAME_WARNING}</p>}
    </div>
  );
  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Kimlik (kod · ad · aile) önce, sınıf ikinci satırda, mekanizmaya ait alanlar sonra. */}
        {FIELDS.slice(0, IDENTITY_COUNT).map(renderField)}
        <WeaveClassFields idPrefix="wd-edit" value={form} keep={savedMech} disabled={!canWrite} onChange={(c) => setForm((f) => ({ ...f, ...c }))} />
        {FIELDS.slice(IDENTITY_COUNT).filter((f) => f.show(m, form)).map(renderField)}
        <DrawingInFields idPrefix="wd" mechanism={m} type={form.drawingInType} note={form.drawingInNote} disabled={!canWrite}
          onType={(t) => setForm((f) => ({ ...f, drawingInType: t }))} onNote={(v) => set("drawingInNote", v)} />
        {m === "JACQUARD" && savedMech === "JACQUARD" && <DesignImageSection design={design} canWrite={canWrite} />}
        {m === "JACQUARD" && savedMech !== "JACQUARD" && (
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Desen görseli, mekanizma Jakar olarak kaydedildikten sonra yüklenebilir.</p>
        )}
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
