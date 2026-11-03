// Belge masası kipi (K23/K26) — kamera ↔ TEK inceleme döngüsü. Belge okununca inceleme açılır; "İş emri oluştur"
// başarılıysa İE no'ları bildirilir, son oluşturulanlar şeridine düşer ve DOĞRUDAN kameraya dönülür. Kayıt yolu
// belgeden İE ile aynıdır (`useWoRows`: satır anahtarlı deneme token'ı, çift dokunuş kapısı); masa yalnız ön seçim ekler.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import type { PickerOption } from '../../../../components/PickerModal';
import { TERIM } from '../../../../lib/terim';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import { INBOUND_DOC_CONTEXT_KEY } from '../DocHeader';
import { removePage } from '../docScan';
import { useDocScan } from '../useDocScan';
import { useWoRows, type DocRow, type WoRowsState } from '../woCreate/useWoRows';
import DeskCamera from './DeskCamera';
import DeskReview from './DeskReview';
import { initialAutoState, type AutoCaptureState } from './autoCapture';
import { clearMachines, pickShortcut, pushRecentWo, recentFromResult, type RecentWo } from './deskPlan';

export const deskSuggestionKey = (owner: string | null) => ['gelen-belge', 'rota-onerisi', owner] as const;

/** Sahibin rota önerisi (müşterinin son İE rotası → müşteri rotası → fabrika varsayılanı). Eski sunucu 404 → null. */
function useSuggestedRouteId(owner: string | null): string | null {
  const q = useQuery({ queryKey: deskSuggestionKey(owner), queryFn: () => inboundDocService.routeSuggestion(owner), retry: false, staleTime: 60_000 });
  return q.data?.routeTemplateId ?? null;
}

/** Rota değişince eski rotanın makine seçimleri düşer (yeni rotanın kurşun istasyonunda geçersiz). */
function useClearMachinesOnRoute(routeId: string, row: DocRow | null, wo: WoRowsState): void {
  const prev = useRef(routeId);
  const { updateForm, setMulti } = wo;
  const noteId = row?.noteId ?? null;
  const multi = row?.form?.multi;
  const machineId = row?.form?.machineId ?? null;
  useEffect(() => {
    if (prev.current === routeId) return;
    prev.current = routeId;
    if (!noteId) return;
    if (machineId) updateForm(noteId, { machineId: null });
    const cleared = clearMachines(multi);
    if (multi && cleared) setMulti(noteId, cleared);
  }, [routeId, noteId, multi, machineId, updateForm, setMulti]);
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
  const route = pickShortcut(shortcuts, { touchedId, suggestedId }) ?? shortcuts[0];
  const wo = useWoRows(route);
  const row = wo.rows[0] ?? null;
  const ownerNow = row?.form?.ownerCustomerId ?? null;
  useEffect(() => setOwner(ownerNow), [ownerNow]);
  useClearMachinesOnRoute(route.id, row, wo);

  const ctx = useQuery({ queryKey: INBOUND_DOC_CONTEXT_KEY, queryFn: inboundDocService.tabletContext, staleTime: 60_000 });
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
  const create = async () => {
    if (!row) return;
    const saved = (await wo.saveAll()).find((x) => x.noteId === row.noteId);
    const item = recentFromResult(row.noteNo, saved?.result ?? null, Date.now());
    if (!item) return; // başarısız: inceleme açık kalır, sonuç satırda; yeniden deneme aynı token'la gider
    announce(item);
    setRecent((l) => pushRecentWo(l, item));
    backToCamera(row.noteId);
  };
  const onError = useCallback((m: string) => Toast.show({ type: 'error', text1: m }), []);

  if (row) {
    return (
      <DeskReview row={row} wo={wo} shortcuts={shortcuts} route={route} onRoute={(r) => setTouchedId(r.id)} machines={ctx.data?.data.kursunMachines}
        customers={customers} customersLoading={ctx.isLoading} onCancel={() => backToCamera(row.noteId)} onCreate={() => void create()} />
    );
  }
  return (
    <DeskCamera pages={b.pages} sending={b.sending} auto={auto} frameMs={frameMs} recent={recent} autoState={autoState} onCaptured={b.capture}
      onRetake={() => b.setPages(removePage(b.pages, b.pages.length - 1))} onRead={() => void b.send()} onError={onError} />
  );
}
