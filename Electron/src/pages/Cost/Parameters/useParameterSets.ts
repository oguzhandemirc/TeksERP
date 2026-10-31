// Parametre ekranının veri + form durumu (sayfa ≤200 satır kalsın diye ayrı). Form değeri TR yazımlı metin;
// gönderirken `toDecimalText` ile Decimal metnine çevrilir — sayıya çevrilmez.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { decToInput, toDecimalText } from "../shared/format";
import { PARAM_FIELDS, type ParamKey } from "./param-fields";
import { buildParamBody, costParamService, type CostParameterSet } from "./service";
import type { ParamForm } from "./ParameterCompareTable";
import { isCostCurrency, showPickFields, useWeavingPickMethod, type PickPair } from "../shared/loom-pick";

const emptyForm = (): ParamForm => Object.fromEntries(PARAM_FIELDS.map((f) => [f.key, ""])) as ParamForm;
const formFrom = (s: CostParameterSet | null): ParamForm =>
  s ? (Object.fromEntries(PARAM_FIELDS.map((f) => [f.key, decToInput(s[f.key])])) as ParamForm) : emptyForm();
const pickFrom = (s: CostParameterSet | null): PickPair => ({
  rate: decToInput(s?.defaultLoomPickRate ?? null),
  currency: isCostCurrency(s?.defaultLoomPickCurrency) ? s.defaultLoomPickCurrency : "",
});

export function useParameterSets() {
  const qc = useQueryClient();
  const active = useQuery({ queryKey: ["cost-params", "active"], queryFn: costParamService.active });
  const draft = useQuery({ queryKey: ["cost-params", "draft"], queryFn: costParamService.draft });
  const [form, setForm] = useState<ParamForm>(emptyForm);
  const [note, setNote] = useState("");
  const [pick, setPick] = useState<PickPair>(() => pickFrom(null));
  const draftRow = draft.data ?? null;
  const method = useWeavingPickMethod();
  const pickVisible = showPickFields(method, { rate: active.data?.defaultLoomPickRate, currency: active.data?.defaultLoomPickCurrency })
    || showPickFields(false, { rate: draftRow?.defaultLoomPickRate, currency: draftRow?.defaultLoomPickCurrency });

  // Sunucudaki taslak değişince form ona eşitlenir (kaydet/yürürlüğe al sonrası).
  useEffect(() => {
    setForm(formFrom(draftRow));
    setNote(draftRow?.note ?? "");
    setPick(pickFrom(draftRow));
  }, [draftRow]);

  const dirty = useMemo(() => {
    const base = formFrom(draftRow);
    const bp = pickFrom(draftRow);
    return PARAM_FIELDS.some((f) => base[f.key] !== form[f.key]) || (draftRow?.note ?? "") !== note
      || bp.rate !== pick.rate || bp.currency !== pick.currency;
  }, [form, note, pick, draftRow]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["cost-params"] });
  const values = (): Partial<Record<ParamKey, string | null>> =>
    Object.fromEntries(PARAM_FIELDS.map((f) => [f.key, toDecimalText(form[f.key])]));
  // Atkı ücreti alanı çizilmiyorsa çift gövdeye girmez (TEZGAH_SAATI kurulumunda gövde bugünküyle aynı).
  const pickBody = () => (pickVisible ? { rate: toDecimalText(pick.rate), currency: pick.currency || null } : undefined);

  const create = useMutation({
    // Yürürlükte set varsa taslak onun kopyasıdır (gövde boş); yoksa ilk set formdaki değerlerle doğar.
    mutationFn: () => costParamService.createDraft(active.data ? {} : buildParamBody(values(), note.trim() || null, pickBody())),
    onSuccess: (r) => { toast.success(r.message ?? "Taslak açıldı."); refresh(); },
  });
  const save = useMutation({
    mutationFn: () => costParamService.updateDraft(draftRow!.id, buildParamBody(values(), note.trim() || null, pickBody())),
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
  return { active, draft, draftRow, form, setField, note, setNote, pick, setPick, pickVisible, dirty, create, save, activate, remove };
}
