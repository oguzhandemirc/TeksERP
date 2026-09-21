import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { loadAllForPicker } from "@/lib/picker-loader";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { returnReasonService } from "@/pages/ReturnReasons/service";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { returnsService } from "./service";
import {
  allRollIds, autoOrders, buildBatchPayload, ordersValid, scopeFromLot, scopeFromRoll, scopeFromSack, scopeFromShipment, summarize,
  type ReturnScope, type ReturnScopeKind,
} from "./returnScope";

/**
 * İADE GİRİŞİ — durum ve mutasyonlar (`ReturnEntryDialog` çizer). Dört giriş yolu tek
 * `scope`a iner; seçim top id kümesi; sipariş SEVKİYAT BAŞINA; neden/not/kalite ortak.
 * Tek grup → `create` (bugünkü yol, tek belge); çok grup → `createBatch` (sevkiyat başına belge).
 */
export function useReturnEntry(open: boolean, initialBarcode: string | undefined, onDone: () => void, gradingEnabled: boolean) {
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState("");
  const [scope, setScope] = useState<ReturnScope | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [orderByGroup, setOrderByGroup] = useState<Map<string, string | null>>(new Map());
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [note, setNote] = useState("");
  const [qualityGradeId, setQualityGradeId] = useState<string | null>(null);
  const [picker, setPicker] = useState<"sack" | "shipment" | "lot" | null>(null);

  const { reasons, grades } = useReturnCatalogs(open, gradingEnabled);

  const reset = () => {
    setBarcode("");
    setScope(null);
    setSelected(new Set());
    setOrderByGroup(new Map());
    setReasonId(null);
    setReasonText("");
    setNote("");
    setQualityGradeId(null);
  };
  const applyScope = (s: ReturnScope) => {
    const all = allRollIds(s); // varsayılan TÜMÜ seçili — "komple geri al" yaygın durum
    setScope(s);
    setSelected(all);
    setOrderByGroup(autoOrders(s, all));
    setReasonId(null);
    setReasonText("");
    setNote("");
    setQualityGradeId(null);
  };

  const { lookupMut, lookupShipmentMut, lookupLotMut } = useReturnLookups(open, initialBarcode, { applyScope, setBarcode, clear: () => setScope(null) });

  const summary = scope ? summarize(scope, selected) : { rollCount: 0, meters: 0, docCount: 0 };
  const hasReason = !!reasonId || reasonText.trim().length > 0;
  const orderOk = scope ? ordersValid(scope, selected, orderByGroup) : false;
  const common = { reasonId, reasonText: reasonText.trim() || null, note: note.trim() || null, qualityGradeId: gradingEnabled ? qualityGradeId : null };

  const createMut = useMutation({
    mutationFn: async () => {
      const payload = buildBatchPayload(scope!, selected, orderByGroup, common);
      // Tek sevkiyat → bugünkü tek-belge yolu (mobil ile aynı uç); çok sevkiyat → toplu.
      if (payload.groups.length === 1) {
        const g = payload.groups[0]!;
        const res = await returnsService.create({ rollIds: g.rollIds, orderId: g.orderId ?? null, ...common });
        return { docs: 1, rollCount: res.data.rollCount ?? 1, message: null as string | null, warn: false };
      }
      const res = await returnsService.createBatch(payload);
      return { docs: res.data.done.length, rollCount: res.data.rollCount, message: res.message ?? null, warn: !!res.data.failed };
    },
    onSuccess: (r) => {
      const msg = r.message ?? `İade alındı — ${r.rollCount} top${r.docs > 1 ? `, ${r.docs} iade belgesi` : ""}.`;
      if (r.warn) toast.warning(msg); else toast.success(msg);
      void qc.invalidateQueries({ queryKey: ["returns"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["shipment-detail"] });
      void qc.invalidateQueries({ queryKey: ["packing-groups"] });
      reset();
      onDone();
    },
  });

  const canSubmit = !!scope && summary.rollCount > 0 && hasReason && orderOk && !createMut.isPending;
  const activeKind: ReturnScopeKind | null = scope?.kind ?? null;

  return {
    barcode, setBarcode, scope, selected, setSelected, orderByGroup, setOrderByGroup,
    reasonId, setReasonId, reasonText, setReasonText, note, setNote, qualityGradeId, setQualityGradeId,
    picker, setPicker, reasons, grades, lookupMut, lookupShipmentMut, lookupLotMut, createMut,
    summary, hasReason, canSubmit, activeKind, reset,
  };
}

/**
 * Üç sorgu yolu + tabancayla açılış tohumu. Tür PREFIX'ten çözülür (CV… çuval, SVK…
 * sevkiyat, T… top); deneme-yanılma yapılmaz — her başarısız deneme interceptor'dan
 * bir hata toast'ı düşürürdü.
 */
function useReturnLookups(
  open: boolean,
  initialBarcode: string | undefined,
  h: { applyScope: (s: ReturnScope) => void; setBarcode: (v: string) => void; clear: () => void },
) {
  const { applyScope, setBarcode, clear } = h;
  const lookupMut = useMutation({
    mutationFn: async (raw: string): Promise<ReturnScope> => {
      const { kind, code } = classifyBarcode(raw);
      if (kind === "SACK") return scopeFromSack((await returnsService.lookupSack(code)).data);
      if (kind === "SHIPMENT") return scopeFromShipment((await returnsService.lookupShipment({ shipmentNo: code })).data);
      return scopeFromRoll((await returnsService.lookup(raw.trim())).data);
    },
    onSuccess: applyScope,
    onError: clear,
  });
  const lookupShipmentMut = useMutation({
    mutationFn: async (shipmentId: string) => scopeFromShipment((await returnsService.lookupShipment({ shipmentId })).data),
    onSuccess: applyScope,
  });
  const lookupLotMut = useMutation({
    mutationFn: async (packingGroupId: string) => scopeFromLot((await returnsService.lookupLot(packingGroupId)).data),
    onSuccess: applyScope,
  });
  // Tabancayla okutularak açıldıysa barkodu bir kez otomatik sorgula.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { seededRef.current = null; return; }
    if (initialBarcode && seededRef.current !== initialBarcode) {
      seededRef.current = initialBarcode;
      setBarcode(initialBarcode);
      lookupMut.mutate(initialBarcode);
    }
    // lookupMut kararlı değil; yalnız open+initialBarcode değişiminde tetikle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialBarcode]);
  return { lookupMut, lookupShipmentMut, lookupLotMut };
}

/** Neden ve kalite katalogları (picker yükü, 5 dk taze). */
function useReturnCatalogs(open: boolean, gradingEnabled: boolean) {
  const reasonsQ = useQuery({
    queryKey: ["return-reasons", "picker"],
    queryFn: () => loadAllForPicker(returnReasonService, { sortBy: "sortOrder" }),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const reasons = useMemo(() => (reasonsQ.data?.data ?? []).filter((r) => r.isActive), [reasonsQ.data?.data]);
  const gradesQ = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    enabled: open && gradingEnabled,
    staleTime: 5 * 60_000,
  });
  const grades = useMemo(() => gradesQ.data?.data ?? [], [gradesQ.data?.data]);
  return { reasons, grades };
}
