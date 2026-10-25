// Parametre ekranının veri + form durumu (sayfa ≤200 satır kalsın diye ayrı). Form değeri TR yazımlı metin;
// gönderirken `toDecimalText` ile Decimal metnine çevrilir — sayıya çevrilmez.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { decToInput, toDecimalText } from "../shared/format";
import { PARAM_FIELDS, type ParamKey } from "./param-fields";
import { buildParamBody, costParamService, type CostParameterSet } from "./service";
import type { ParamForm } from "./ParameterCompareTable";

const emptyForm = (): ParamForm => Object.fromEntries(PARAM_FIELDS.map((f) => [f.key, ""])) as ParamForm;
const formFrom = (s: CostParameterSet | null): ParamForm =>
  s ? (Object.fromEntries(PARAM_FIELDS.map((f) => [f.key, decToInput(s[f.key])])) as ParamForm) : emptyForm();

export function useParameterSets() {
  const qc = useQueryClient();
  const active = useQuery({ queryKey: ["cost-params", "active"], queryFn: costParamService.active });
  const draft = useQuery({ queryKey: ["cost-params", "draft"], queryFn: costParamService.draft });
  const [form, setForm] = useState<ParamForm>(emptyForm);
  const [note, setNote] = useState("");
  const draftRow = draft.data ?? null;

  // Sunucudaki taslak değişince form ona eşitlenir (kaydet/yürürlüğe al sonrası).
  useEffect(() => {
    setForm(formFrom(draftRow));
    setNote(draftRow?.note ?? "");
  }, [draftRow]);

  const dirty = useMemo(() => {
    const base = formFrom(draftRow);
    return PARAM_FIELDS.some((f) => base[f.key] !== form[f.key]) || (draftRow?.note ?? "") !== note;
  }, [form, note, draftRow]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["cost-params"] });
  const values = (): Partial<Record<ParamKey, string | null>> =>
    Object.fromEntries(PARAM_FIELDS.map((f) => [f.key, toDecimalText(form[f.key])]));

  const create = useMutation({
    // Yürürlükte set varsa taslak onun kopyasıdır (gövde boş); yoksa ilk set formdaki değerlerle doğar.
    mutationFn: () => costParamService.createDraft(active.data ? {} : buildParamBody(values(), note.trim() || null)),
    onSuccess: (r) => { toast.success(r.message ?? "Taslak açıldı."); refresh(); },
  });
  const save = useMutation({
    mutationFn: () => costParamService.updateDraft(draftRow!.id, buildParamBody(values(), note.trim() || null)),
    onSuccess: (r) => { toast.success(r.message ?? "Taslak kaydedildi."); refresh(); },
  });
  const activate = useMutation({
    mutationFn: () => costParamService.activate(draftRow!.id),
    onSuccess: (r) => { toast.success(r.message ?? "Yürürlüğe alındı."); refresh(); void qc.invalidateQueries({ queryKey: ["cost-items"] }); },
  });
  const remove = useMutation({
    mutationFn: () => costParamService.remove(draftRow!.id),
    onSuccess: (r) => { toast.success(r.message ?? "Taslak silindi."); refresh(); },
  });

  const setField = (k: ParamKey, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return { active, draft, draftRow, form, setField, note, setNote, dirty, create, save, activate, remove };
}
