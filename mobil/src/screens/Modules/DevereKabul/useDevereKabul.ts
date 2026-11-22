// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — ekran durumu: bağlam · taslak siparişler/satırlar · gönderim
// =============================================================================
// Online-only (kuyruk YOK). Bağlam devereci süzgeciyle yeniden çekilir; belge tek deverecili olduğundan
// devereci değişince taslak boşalır. Gönderim (`useReceiveSubmit`) panelle AYNI belge ucunu kullanır.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { devereKabulService, type WarpingTabletContext, type WarpingTabletOrder } from '../../../services/devereKabul.service';
import { useIsOnline, useOfflineReason } from '../../../offline/hooks';
import { autoPickOrderId, autoPickSubcontractorId, buildDocBody, nextPlanLength, type BeamDraft, type OrderDraft } from './receiveDocPayload';
import { useBodyScan, useReceiveSubmit } from './useReceiveSubmit';
import { labelsAutoQueued, normalizeAutoPrint } from './useBeamCardPrint';
import { useBeamReject } from './useBeamReject';

export const DEVERE_KABUL_CTX_KEY = ['devere-kabul', 'context'] as const;
/** Açık satır sayfası: hangi siparişe, hangi taslak; `editing` doluysa mevcut satır düzeltiliyor. */
export interface LineSheet { orderId: string; draft: BeamDraft; editing: boolean }

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;
const DEFAULT_SETTINGS: WarpingTabletContext['settings'] = { beamBodyMode: 'OFF', receiveWeighing: 'OPTIONAL', duplicateDeliveryNote: 'ALLOW' };

/** Taslak siparişler + satır sayfası (saf durum; ağ yok). */
function useOrderDrafts(ctxOrders: WarpingTabletOrder[]) {
  const [orders, setOrders] = useState<OrderDraft[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const activeOrder = ctxOrders.find((o) => o.id === activeOrderId) ?? null;
  const [sheet, setSheet] = useState<LineSheet | null>(null);
  const addOrder = useCallback((o: WarpingTabletOrder) => {
    setOrders((prev) => (prev.some((x) => x.orderId === o.id) ? prev : [...prev, { orderId: o.id, orderNo: o.orderNo, beams: [] }]));
    setActiveOrderId(o.id);
  }, []);
  const removeOrder = useCallback((id: string) => {
    setOrders((prev) => prev.filter((o) => o.orderId !== id));
    setActiveOrderId((cur) => (cur === id ? null : cur));
  }, []);
  const clear = useCallback(() => { setOrders([]); setActiveOrderId(null); }, []);
  /** Yeni satır sayfası: gövde (okutulan) + plan boyu ön dolu. */
  const openNewLine = useCallback((body: BeamDraft['body']) => {
    if (!activeOrder) return;
    const drafted = orders.find((o) => o.orderId === activeOrder.id)?.beams.length ?? 0;
    setSheet({ orderId: activeOrder.id, editing: false, draft: { key: newKey(), body, physicalBeamNo: '', lengthM: nextPlanLength(activeOrder, drafted), grossKg: '', tareKg: '' } });
  }, [activeOrder, orders]);
  const editLine = useCallback((orderId: string, draft: BeamDraft) => setSheet({ orderId, draft, editing: true }), []);
  const saveLine = useCallback((s: LineSheet) => {
    setOrders((prev) => prev.map((o) => (o.orderId !== s.orderId ? o : { ...o, beams: s.editing ? o.beams.map((b) => (b.key === s.draft.key ? s.draft : b)) : [...o.beams, s.draft] })));
    setSheet(null);
  }, []);
  const removeLine = useCallback((orderId: string, key: string) => {
    setOrders((prev) => prev.map((o) => (o.orderId === orderId ? { ...o, beams: o.beams.filter((b) => b.key !== key) } : o)));
    setSheet(null);
  }, []);
  return { orders, activeOrder, activeOrderId, setActiveOrderId, addOrder, removeOrder, clear, sheet, setSheet, openNewLine, editLine, saveLine, removeLine };
}

export function useDevereKabul() {
  const qc = useQueryClient();
  const isOnline = useIsOnline();
  const offlineReason = useOfflineReason();
  const [subcontractorId, setSubId] = useState<string | null>(null);
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('');
  const context = useQuery({ queryKey: [...DEVERE_KABUL_CTX_KEY, subcontractorId ?? ''], queryFn: () => devereKabulService.context(subcontractorId), staleTime: 30_000 });
  const settings = context.data?.settings ?? DEFAULT_SETTINGS;
  const ctxOrders = useMemo(() => (subcontractorId ? context.data?.orders ?? [] : []), [context.data, subcontractorId]);
  const drafts = useOrderDrafts(ctxOrders);
  const subcontractor = context.data?.subcontractors.find((s) => s.id === subcontractorId) ?? null;
  const build = useMemo(() => buildDocBody(drafts.orders, { subcontractorId, deliveryNoteNo, weighing: settings.receiveWeighing }), [drafts.orders, subcontractorId, deliveryNoteNo, settings.receiveWeighing]);
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: DEVERE_KABUL_CTX_KEY }), [qc]);
  const { clear, addOrder: addDraft } = drafts;
  // Tek açık sipariş kendiliğinden seçilir — devereci başına bir kez (kaldırılırsa geri gelmez); kabulden sonra yeniden.
  const autoDone = useRef<string | null>(null);
  const fetching = context.isFetching;
  useEffect(() => {
    if (fetching) return; // kabul sonrası tazelenirken eski (artık kapanmış) sipariş seçilmesin
    const id = autoPickOrderId(ctxOrders, drafts.orders.length, autoDone.current === subcontractorId);
    const o = id ? ctxOrders.find((x) => x.id === id) : undefined;
    if (!o) return;
    autoDone.current = subcontractorId;
    addDraft(o);
  }, [fetching, ctxOrders, drafts.orders.length, subcontractorId, addDraft]);
  const submit = useReceiveSubmit(
    build,
    useCallback(() => { clear(); setDeliveryNoteNo(''); autoDone.current = null; refresh(); }, [clear, refresh]),
    labelsAutoQueued(normalizeAutoPrint(settings.beamCardAutoPrint)),
  );
  const reject = useBeamReject({ isOnline, onRejected: refresh });
  const scan = useBodyScan({ hasOrder: !!drafts.activeOrder, orders: drafts.orders, onBody: drafts.openNewLine });
  const selectSubcontractor = useCallback((id: string) => {
    if (id === subcontractorId) return;
    setSubId(id);
    clear();
  }, [subcontractorId, clear]);
  // Kabul bekleyen tek devereci varsa seçici penceresi açtırılmaz (sahayı yavaşlatmasın).
  const subs = context.data?.subcontractors;
  useEffect(() => {
    const id = autoPickSubcontractorId(subs ?? [], subcontractorId);
    if (id) setSubId(id);
  }, [subs, subcontractorId]);
  const addOrder = useCallback((id: string) => {
    const o = ctxOrders.find((x) => x.id === id);
    if (o) addDraft(o);
  }, [ctxOrders, addDraft]);
  /** Satır sayfasının yeniden sarım adayları: siparişin adayları − bu taslağın başka satırında seçilmişler. */
  const reworkFor = useCallback((sh: LineSheet) => {
    const used = new Set(drafts.orders.find((o) => o.orderId === sh.orderId)?.beams.filter((b) => b.key !== sh.draft.key).map((b) => b.reworkOfBeamId) ?? []);
    return (ctxOrders.find((o) => o.id === sh.orderId)?.reworkCandidates ?? []).filter((c) => !used.has(c.beamId));
  }, [drafts.orders, ctxOrders]);
  return {
    reworkFor, context, isOnline, offlineReason, refresh, settings, subcontractors: context.data?.subcontractors ?? [], subcontractor, subcontractorId, selectSubcontractor,
    ctxOrders, ...drafts, addOrder, deliveryNoteNo, setDeliveryNoteNo, build, ...scan, ...submit, reject,
  };
}

export type DevereKabulState = ReturnType<typeof useDevereKabul>;
