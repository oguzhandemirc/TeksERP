// Desen bilgileri sekmesi: desen kimliği + sınıf (mekanizma · örgü) + mekanizmaya ait tezgâh bilgileri. Alanlar
// mekanizmaya göre: Armür → çerçeve/.DOP/tahar · Jakar → desen dosyası, kanca, rapor en×boy, görsel ·
// Eksantrik → örgü + tahar. Gizli alan GÖNDERİLMEZ (saklı değer silinmez; sunucu zaten Armür dışı ızgarayı,
// Jakar dışı kancayı reddeder). Boş gönderilen görünür alanı sunucu NULL'a çevirir.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/forms/FormField";
import { weaveDesignApi } from "../service";
import type { DesignFabric, WeaveDesign, WeaveDesignInput } from "../types";
import { resolveWeaveClass, type ShedMechanism, type WeaveClass } from "../weave-class";
import { WeaveClassFields } from "../WeaveClassFields";
import { DrawingInFields, drawingInApplies } from "../DrawingInFields";
import { LOOM_FILE_NAME_WARNING, loomFileNameTooLong } from "../loom-file-name";
import type { DrawingInType } from "@/components/weave/weave-drawing-in";
import { DesignImageSection } from "./DesignImageSection";
import { WarpLayersSection } from "./WarpLayersSection";
import { decimalToTrFormText } from "@/lib/decimal-form-text";

type TextKey = "code" | "name" | "familyLabel" | "frameCount" | "repeatCm" | "repeatWidthCm" | "hookCount" | "loomFileName" | "lenoSetup" | "drawingInNote" | "notes";
type Form = Record<TextKey, string> & WeaveClass & { drawingInType: DrawingInType | null };

interface FieldDef {
  key: TextKey; label: string; max: number; mode?: "numeric" | "decimal"; info?: string; required?: boolean; placeholder?: string;
  show: (m: ShedMechanism, f: Form) => boolean;
}

const ALL = () => true;
/** FIELDS'in ilk üçü kimlik alanları (her mekanizmada). */
const IDENTITY_COUNT = 3;
/** T1 (ürün kartı denetimi): aile örgüyü/kumaş türünü tekrar sormaz — onların yeri başka. */
export const FAMILY_INFO = "Desenleri gruplayan ad (ör. BALIK). Toplu atkı ücreti ve listede gruplama içindir. Kumaş türü (tül/fon) ürün kartında, örgü desen kartında seçilir; buraya yazmayın. (Eski adı: Aile etiketi)";
const FIELDS: FieldDef[] = [
  { key: "code", label: "Desen kodu", required: true, max: 32, show: ALL },
  { key: "name", label: "Desen adı", required: true, max: 100, show: ALL },
  { key: "familyLabel", label: "Desen ailesi", max: 40, info: FAMILY_INFO, placeholder: "ör. BALIK", show: ALL },
  { key: "frameCount", label: "Çerçeve sayısı", max: 2, mode: "numeric", info: "Armürün kullandığı çerçeve (gücü) sayısı; 1–32.", show: (m) => m === "DOBBY" },
  { key: "repeatCm", label: "Rapor boyu (cm)", max: 10, mode: "decimal", info: "Desenin boyuna bir kez tekrar ettiği uzunluk.", show: (m) => m !== "JACQUARD" },
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
    repeatCm: decimalToTrFormText(d.repeatCm), repeatWidthCm: decimalToTrFormText(d.repeatWidthCm ?? null), hookCount: d.hookCount?.toString() ?? "",
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

export function StructureTab({ design, fabric, canWrite, onOpenItem }: { design: WeaveDesign; fabric: DesignFabric | null; canWrite: boolean; onOpenItem?: () => void }) {
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
    <FormField key={`${f.key}-${f.label}`} label={f.label} htmlFor={`wd-${f.key}`} required={f.required} info={f.info}
      hint={f.key === "loomFileName" && loomFileNameTooLong(form.loomFileName) ? LOOM_FILE_NAME_WARNING : undefined} hintTone="warning">
      <Input id={`wd-${f.key}`} value={form[f.key]} maxLength={f.max} inputMode={f.mode} placeholder={f.placeholder} disabled={!canWrite} onChange={(e) => set(f.key, e.target.value)} />
    </FormField>
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
        <FormField className="sm:col-span-2 lg:col-span-3" label="Not" htmlFor="wd-notes">
          <Textarea id="wd-notes" value={form.notes} maxLength={500} disabled={!canWrite} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
        {canWrite && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Button disabled={save.isPending || !form.code.trim() || !form.name.trim()} onClick={() => save.mutate()}>Kaydet</Button>
          </div>
        )}
      </section>
      {fabric && <WarpLayersSection fabric={fabric} canWrite={canWrite} place="design" onOpenItem={onOpenItem} />}
    </div>
  );
}
