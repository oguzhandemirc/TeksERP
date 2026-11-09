// Belge masası kipi (K23/K26) — kamera ↔ TEK inceleme döngüsü. Belge okununca inceleme açılır; "İş emri oluştur"
// başarılıysa İE no'ları bildirilir, son oluşturulanlar şeridine düşer ve DOĞRUDAN kameraya dönülür. Kayıt yolu
// belgeden İE ile aynıdır (`useWoRows`: satır anahtarlı deneme token'ı, çift dokunuş kapısı); masa yalnız ön seçim ekler.
import { defaultWoTypeFor } from '../../../../store/woCreateKinds';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import type { PickerOption } from '../../../../components/PickerModal';
import { TERIM } from '../../../../lib/terim';
import { inboundDocService, type DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import { INBOUND_DOC_CONTEXT_KEY } from '../DocHeader';
import { removePage } from '../docScan';
import { useDocScan } from '../useDocScan';
import { printCard, useWoRows, type DocRow, type WoRowsState } from '../woCreate/useWoRows';
import { isScanRoute } from '../woCreate/woFromDoc';
import { DuplicateDocNoDialog } from '../DuplicateDocNoDialog';
import { DuplicateBatchNoDialog } from '../DuplicateBatchNoDialog';
import DeskCamera from './DeskCamera';
import DeskReview from './DeskReview';
import { initialAutoState, type AutoCaptureState } from './autoCapture';
import { markRecentPrint, pickShortcut, pushRecentWo, recentFromResult, routeDefaultMachineId, seedMachines, type RecentWo } from './deskPlan';

export const deskSuggestionKey = (owner: string | null) => ['gelen-belge', 'rota-onerisi', owner] as const;

/** Sahibin rota önerisi (müşterinin son İE rotası → müşteri rotası → fabrika varsayılanı). Eski sunucu 404 → null. */
function useSuggestedRouteId(owner: string | null): string | null {
  const q = useQuery({ queryKey: deskSuggestionKey(owner), queryFn: () => inboundDocService.routeSuggestion(owner), retry: false, staleTime: 60_000 });
  return q.data?.routeTemplateId ?? null;
}

/** Makine ön seçimi görünür: rota şablonunun önerisi (rota değişince yenisine döner); kullanıcı seçimi ezilmez. */
function useSeedMachines(route: ProductionRoute, row: DocRow | null, wo: WoRowsState, machines: readonly DeskKursunMachine[] | undefined): void {
  const prev = useRef(route.id);
  const { updateForm, setMulti } = wo;
  const noteId = row?.noteId ?? null;
  const form = row?.form ?? null;
  const def = machines ? routeDefaultMachineId(route, machines) : undefined;
  useEffect(() => {
    const reset = prev.current !== route.id;
    prev.current = route.id;
    if (!noteId || !form || machines === undefined) return;
    const patch = seedMachines(form, def, reset);
    if (!patch) return;
    if ('machineId' in patch) updateForm(noteId, { machineId: patch.machineId });
    if (patch.multi) setMulti(noteId, patch.multi);
  }, [route.id, noteId, form, machines, def, updateForm, setMulti]);
}

function announce(item: RecentWo): void {
  const text1 = item.workOrderNos.length
    ? `${TERIM.terbiyeIsEmri.tekil} açıldı: ${item.workOrderNos.join(', ')}`
    : `${item.noteNo} taslak olarak kaydedildi`;
  Toast.show({ type: 'success', text1, text2: 'Sıradaki belgeyi masaya koyun.' });
}

export default function DeskView({ shortcuts }: { shortcuts: readonly ProductionRoute[] }) {
  const auto = useDeviceSettingsStore((s) => s.docDeskCaptureMode === 'auto');
  const frameMs = useDeviceSettingsStore((s) => s.docDeskFrameMs);
  const [touchedId, setTouchedId] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentWo[]>([]);
  const autoState = useRef<AutoCaptureState>(initialAutoState()); // inceleme kamerayı söker; boş masa referansı burada yaşar
  const b = useDocScan({ successHint: 'Okuma bitince inceleme ekranı açılır.' });
  const [owner, setOwner] = useState<string | null>(null);
  const suggestedId = useSuggestedRouteId(owner);
  // K29 S14b: "Okutmayla" kipinde rotasız seçenek başta ve varsayılandır — müşteri rota önerisi onu ezmez.
  const route = pickShortcut(shortcuts, { touchedId, suggestedId: isScanRoute(shortcuts[0]) ? null : suggestedId }) ?? shortcuts[0];
  // Cihaz varsayılan türü: Seçenekler'de yalnız Fason açıksa masadan açılan İE de Fason (müşteri malı).
  const woType = useDeviceSettingsStore((s) => defaultWoTypeFor(s.woCreateKinds));
  const wo = useWoRows(route, woType ? { extraBody: () => ({ type: woType }) } : undefined);
  const row = wo.rows[0] ?? null;
  const ownerNow = row?.form?.ownerCustomerId ?? null;
  useEffect(() => setOwner(ownerNow), [ownerNow]);
  const ctx = useQuery({ queryKey: INBOUND_DOC_CONTEXT_KEY, queryFn: inboundDocService.tabletContext, staleTime: 60_000 });
  useSeedMachines(route, row, wo, ctx.data?.data.kursunMachines);
  const customers: PickerOption[] = useMemo(() => (ctx.data?.data.customers ?? []).map((x) => ({ value: x.id, label: x.name })), [ctx.data]);

  const { addNote } = wo;
  const doneNote = b.done?.note;
  const doneRun = b.done?.runKey ?? 0;
  useEffect(() => {
    if (doneNote) addNote(doneNote, doneRun);
  }, [doneNote, doneRun, addNote]);

  const backToCamera = (noteId: string) => {
    wo.removeRow(noteId);
    b.finish();
    setTouchedId(null);
  };
  // `confirm` = mükerrer diyaloğunda "Yine de" (K27 belge no · müşteri parti no; gövdeye bayrak).
  const create = async (confirm?: 'docNo' | 'batchNo') => {
    if (!row) return;
    const run = confirm === 'docNo' ? wo.confirmDuplicate : confirm === 'batchNo' ? wo.confirmDuplicateBatch : wo.saveAll;
    const saved = (await run()).find((x) => x.noteId === row.noteId);
    const item = recentFromResult(row.noteNo, saved?.result ?? null, Date.now());
    if (!item) return; // başarısız: inceleme açık kalır, sonuç satırda; yeniden deneme aynı token'la gider
    announce(item);
    setRecent((l) => pushRecentWo(l, item));
    backToCamera(row.noteId);
  };
  const onError = useCallback((m: string) => Toast.show({ type: 'error', text1: m }), []);
  // Elle basım (çok partide her İE'nin kartı); biri düşerse kayıt "yeniden yazdır"a döner.
  const printRecent = async (item: RecentWo) => {
    let ok = true;
    for (const id of item.workOrderIds ?? []) ok = (await printCard(id)) && ok;
    setRecent((l) => markRecentPrint(l, item.noteNo, ok));
  };

  if (row) {
    return (
      <>
        <DeskReview row={row} wo={wo} shortcuts={shortcuts} route={route} onRoute={(r) => setTouchedId(r.id)} machines={ctx.data?.data.kursunMachines}
          customers={customers} customersLoading={ctx.isLoading} onCancel={() => backToCamera(row.noteId)} onCreate={() => void create()} />
        <DuplicateDocNoDialog conflict={wo.duplicate?.conflict ?? null} busy={wo.saving} onCancel={wo.dismissDuplicate} onConfirm={() => void create('docNo')} />
        <DuplicateBatchNoDialog conflict={wo.duplicateBatch?.conflict ?? null} busy={wo.saving} onCancel={wo.dismissDuplicateBatch} onConfirm={() => void create('batchNo')} />
      </>
    );
  }
  return (
    <DeskCamera pages={b.pages} sending={b.sending} auto={auto} frameMs={frameMs} recent={recent} onPrint={(r) => void printRecent(r)} autoPrint={wo.autoPrint} autoState={autoState} onCaptured={b.capture}
      onRetake={() => b.setPages(removePage(b.pages, b.pages.length - 1))} onRead={() => void b.send()} onError={onError} />
  );
}
