// Belgeden terbiye iş emri (K6/K7/K8) — satır listesi + "Hepsini kaydet". ONLINE-ONLY: kayıt top doğurur, kuyruğa alınmaz.
// Kip sunucu ayarından (formApproval); kapalıyken satır taslak olarak kalır (bugünkü ayrı onay). Satır başına sonuç.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { onlineManager, useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { isAmbiguousFailure } from '../../../../offline/entryAttempt';
import { useRefakatAutoPrint } from '../../../../hooks/useFeatureFlags';
import { fabricPropertyService, type KursunGramajCatalog } from '../../../../services/fabricProperty.service';
import { inboundDocService, type InboundNoteDetail } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { printTravelerCardForWorkOrder } from '../../../../services/travelerCardPrint';
import { loadRecentOwners, rememberOwner } from './recentOwners';
import {
  buildCreateBody,
  buildDraftPatch,
  draftResult,
  errorText,
  initialRowForm,
  isFormApprovalDisabled,
  openedResult,
  resolveFormApproval,
  routeHasKursunStep,
  rowIssues,
  type RowForm,
  type RowResult,
} from './woFromDoc';

export interface DocRow {
  noteId: string;
  noteNo: string;
  runKey: number;
  detail: InboundNoteDetail | null;
  form: RowForm | null;
  /** Kullanıcı gramajı elle seçti/kaldırdı: geç gelen katalog varsayılanı onu ezmez. */
  gramajTouched: boolean;
  result: RowResult | null;
}

const EMPTY_CATALOG: KursunGramajCatalog = { propertyId: null, options: [] };
export const INBOUND_DOC_SETTINGS_KEY = ['gelen-belge', 'ayarlar'] as const;

const isDone = (r: DocRow) => r.result?.kind === 'OPENED' || r.result?.kind === 'DRAFT';

export function useWoRows(route: ProductionRoute) {
  const attempt = useAttemptToken();
  const autoPrint = useRefakatAutoPrint();
  const settings = useQuery({ queryKey: INBOUND_DOC_SETTINGS_KEY, queryFn: inboundDocService.settings, retry: false, staleTime: 60_000 });
  const mode = resolveFormApproval(settings.data, settings.isError);
  const showGramaj = routeHasKursunStep(route);
  const catalogQ = useQuery({
    queryKey: ['fabric-properties', 'kursun-gramaj-catalog'],
    queryFn: fabricPropertyService.getKursunGramajCatalog,
    enabled: showGramaj,
    retry: false,
    staleTime: 60_000,
  });
  const catalog = showGramaj ? catalogQ.data ?? EMPTY_CATALOG : EMPTY_CATALOG;
  const [rows, setRows] = useState<DocRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    void loadRecentOwners().then(setRecent);
  }, []);

  // Katalog satırdan sonra gelirse dokunulmamış satırlara varsayılan gramaj düşer.
  const defaultGramaj = catalog.options.find((o) => o.isDefault)?.id ?? null;
  useEffect(() => {
    if (!defaultGramaj) return;
    setRows((rs) => rs.map((r) => (r.form && !r.gramajTouched && !r.form.gramajValueId && !isDone(r) ? { ...r, form: { ...r.form, gramajValueId: defaultGramaj } } : r)));
  }, [defaultGramaj]);

  const addNote = useCallback((note: { id: string; noteNo: string }, runKey: number) => {
    setRows((rs) =>
      rs.some((r) => r.noteId === note.id)
        ? rs.map((r) => (r.noteId === note.id ? { ...r, runKey } : r))
        : [...rs, { noteId: note.id, noteNo: note.noteNo, runKey, detail: null, form: null, gramajTouched: false, result: null }],
    );
  }, []);

  const setDetail = useCallback(
    (noteId: string, detail: InboundNoteDetail) => {
      setRows((rs) => rs.map((r) => (r.noteId === noteId ? { ...r, detail, form: r.form ?? initialRowForm(detail, catalog, showGramaj) } : r)));
    },
    [catalog, showGramaj],
  );

  const updateForm = useCallback((noteId: string, patch: Partial<RowForm>) => {
    setRows((rs) =>
      rs.map((r) =>
        r.noteId === noteId && r.form
          ? { ...r, form: { ...r.form, ...patch }, gramajTouched: r.gramajTouched || 'gramajValueId' in patch, result: isDone(r) ? r.result : null }
          : r,
      ),
    );
  }, []);

  const removeRow = useCallback((noteId: string) => setRows((rs) => rs.filter((r) => r.noteId !== noteId)), []);
  const setResult = (noteId: string, result: RowResult) => setRows((rs) => rs.map((r) => (r.noteId === noteId ? { ...r, result } : r)));

  const printFor = async (noteId: string, workOrderId: string) => {
    let ok = true;
    try {
      await printTravelerCardForWorkOrder(workOrderId);
    } catch (e) {
      ok = false;
      Toast.show({ type: 'error', text1: 'Refakat kartı basılamadı', text2: errorText(e) });
    }
    setRows((rs) => rs.map((r) => (r.noteId === noteId && r.result?.kind === 'OPENED' ? { ...r, result: { ...r.result, print: ok ? 'PRINTED' : 'PRINT_FAILED' } } : r)));
  };

  const saveDraft = async (r: DocRow, form: RowForm, disabledByServer: boolean): Promise<RowResult> => {
    const patch = buildDraftPatch(form, r.detail!);
    if (Object.keys(patch).length) await inboundDocService.updateNote(r.noteId, patch);
    return draftResult(r.noteNo, disabledByServer);
  };

  const saveOne = async (r: DocRow, form: RowForm): Promise<{ result: RowResult; error?: unknown }> => {
    if (mode === 'SEPARATE') {
      try {
        return { result: await saveDraft(r, form, false) };
      } catch (e) {
        return { result: { kind: 'FAILED', text: errorText(e) } };
      }
    }
    const issues = rowIssues(form);
    if (issues.length) return { result: { kind: 'FAILED', text: issues.join(' ') } };
    try {
      const body = buildCreateBody(form, { clientToken: attempt.keyed(r.noteId), routeTemplateId: route.id, gramajPropertyId: catalog.propertyId });
      return { result: openedResult(await inboundDocService.createWorkOrder(r.noteId, body)) };
    } catch (e) {
      if (!isFormApprovalDisabled(e)) return { result: { kind: 'FAILED', text: errorText(e) }, error: e };
      try {
        return { result: await saveDraft(r, form, true) };
      } catch (e2) {
        return { result: { kind: 'FAILED', text: errorText(e2) } };
      }
    }
  };

  const pending = rows.filter((r) => r.form && r.detail && !isDone(r));

  const saveAll = async () => {
    if (saving || pending.length === 0) return;
    if (!onlineManager.isOnline()) {
      Toast.show({ type: 'error', text1: 'Sunucuya bağlantı yok', text2: 'Kayıt çevrimiçi yapılır; bağlantı gelince yeniden deneyin.' });
      return;
    }
    setSaving(true);
    const errors: unknown[] = [];
    let owners = recent;
    try {
      // Sırayla: her satır ayrı tx; biri düşerse diğerleri etkilenmez, sonuç satırda kalır.
      for (const r of pending) {
        const { result, error } = await saveOne(r, r.form!);
        if (error !== undefined) errors.push(error);
        setResult(r.noteId, result);
        if (result.kind !== 'FAILED' && r.form!.ownerCustomerId) owners = await rememberOwner(owners, r.form!.ownerCustomerId);
        if (result.kind === 'OPENED' && autoPrint) await printFor(r.noteId, result.workOrderId);
      }
    } finally {
      setRecent(owners);
      setSaving(false);
    }
    // Deneme sonucu: belirsiz hata varsa satır token'ları yapışır (yeniden "Hepsini kaydet" aynı kaydı tekrarlamaz).
    if (errors.length) attempt.onFailure(errors.find(isAmbiguousFailure) ?? errors[0]);
    else attempt.onSuccess();
  };

  const counts = useMemo(
    () => ({
      total: rows.length,
      ready: pending.length,
      reading: rows.filter((r) => !r.detail).length,
      opened: rows.filter((r) => r.result?.kind === 'OPENED').length,
      drafts: rows.filter((r) => r.result?.kind === 'DRAFT').length,
      failed: rows.filter((r) => r.result?.kind === 'FAILED').length,
    }),
    [rows, pending.length],
  );

  return {
    rows, mode, showGramaj, catalog, saving, recent, counts, autoPrint,
    addNote, setDetail, updateForm, removeRow, saveAll,
    print: (noteId: string, workOrderId: string) => void printFor(noteId, workOrderId),
  };
}

export type WoRowsState = ReturnType<typeof useWoRows>;
