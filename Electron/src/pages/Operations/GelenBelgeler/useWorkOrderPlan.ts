// Belgeden iş emri modalının durumu: plan, rota, grup seçimi, düzeltilmiş hedefler, grup başına deneme token'ı.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAttemptToken } from "@/lib/attemptToken";
import { loadAllForPicker } from "@/lib/picker-loader";
import { useFoldValues } from "@/hooks/useFoldValues";
import { routeService } from "@/pages/Routes/service";
import { workOrderService } from "@/pages/Operations/WorkOrders/service";
import { getWorkOrderPlan, INCOMING_DOCUMENT_QUERY_KEY } from "./service";
import type { ChoiceProperty, PlanTarget } from "./types";
import { decisiveFailure, startGroupWorkOrders } from "./workOrderFromNote";

export function useWorkOrderPlan(noteId: string, open: boolean) {
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "is-emri-plani", noteId], queryFn: () => getWorkOrderPlan(noteId), enabled: open });
  const routes = useQuery({ queryKey: ["routes", "note-wo-picker"], queryFn: () => loadAllForPicker(routeService, { sortBy: "name" }), enabled: open, staleTime: 5 * 60_000 });
  const routeList = useMemo(() => (routes.data?.data ?? []).filter((r) => r.isActive), [routes.data]);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [foldType, setFoldType] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, PlanTarget[]>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  // Deneme başına token, grup başına AYRI alt token (`keyed`): belirsiz hatada yapışır, kesin 4xx'te yenilenir (kk1.md).
  const attempt = useAttemptToken();
  const { values: foldValues } = useFoldValues();

  useEffect(() => {
    if (!open) return;
    attempt.renew();
    setOverrides({});
    setDone({});
    setRouteId(null);
  }, [open, noteId, attempt]);
  useEffect(() => {
    if (!plan.data) return;
    setChecked(Object.fromEntries(plan.data.groups.map((g) => [g.key, g.attachableCount > 0])));
    setRouteId((cur) => cur ?? plan.data.suggestedRouteTemplateId ?? null);
  }, [plan.data]);

  const route = routeList.find((r) => r.id === routeId) ?? null;
  const hasTambur = (route?.steps ?? []).some((s) => s.station?.kind === "TAMBUR");
  useEffect(() => {
    setFoldType((cur) => (hasTambur ? (cur ?? foldValues[0]?.code ?? null) : null));
  }, [hasTambur, foldValues]);

  const groups = plan.data?.groups ?? [];
  const targetsOf = (key: string) => overrides[key] ?? groups.find((g) => g.key === key)?.targets ?? [];
  const setValue = (key: string, p: ChoiceProperty, value: { id: string; name: string } | null) => {
    const rest = targetsOf(key).filter((t) => t.propertyId !== p.propertyId);
    const next = value ? [...rest, { propertyId: p.propertyId, propertyName: p.propertyName, flagPropertyId: p.flagPropertyId, valueId: value.id, valueName: value.name, source: "MANUAL" as const }] : rest;
    setOverrides((o) => ({ ...o, [key]: next }));
  };
  const selected = groups.filter((g) => checked[g.key] && !done[g.key] && g.attachableCount > 0);

  const start = useMutation({
    mutationFn: () =>
      startGroupWorkOrders(selected.map((g) => ({ group: g, targets: targetsOf(g.key) })), {
        routeTemplateId: routeId as string,
        foldType,
        tokenFor: (key) => attempt.keyed(key),
        quickStart: workOrderService.quickStart,
      }),
    onSuccess: (outcomes) => {
      const ok = outcomes.filter((o) => o.ok);
      const failure = decisiveFailure(outcomes);
      if (failure) attempt.onFailure(failure.error);
      else attempt.onSuccess();
      setDone((d) => ({ ...d, ...Object.fromEntries(ok.map((o) => [o.key, o.workOrderNumber ?? "?"])) }));
      const warnings = [...new Set(ok.flatMap((o) => o.warnings ?? []))];
      if (ok.length > 0) toast.success(`${ok.length} iş emri açıldı: ${ok.map((o) => o.workOrderNumber).join(", ")}`, { description: warnings.join(" ") || undefined, duration: 10_000 });
      if (ok.length < outcomes.length) toast.error(`${outcomes.length - ok.length} grup açılamadı — hatayı düzeltip yeniden deneyin (açılanlar tekrar gönderilmez).`);
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "is-emri-plani", noteId] });
    },
  });

  return { plan, routes, routeList, routeId, setRouteId, route, hasTambur, foldType, setFoldType, foldValues, groups, checked, setChecked, targetsOf, setValue, selected, done, start };
}
