// Belgeden terbiye iş emri (K6/K7/K8) — satır listesi + "Hepsini kaydet". ONLINE-ONLY: kayıt top doğurur, kuyruğa alınmaz.
// Kip sunucu ayarından (formApproval); kapalıyken satır taslak olarak kalır (bugünkü ayrı onay). Satır başına sonuç.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { onlineManager, useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { isAmbiguousFailure } from '../../../../offline/entryAttempt';
import { INBOUND_DOC_SETTINGS_KEY, inboundDocService, type CreateWorkOrderFromNoteBody, type InboundNoteDetail, type SameDocumentMatch, type NotePartiesView } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { printTravelerCardForWorkOrder } from '../../../../services/travelerCardPrint';
import { kursunStepOf } from '../desk/deskPlan';
import { duplicateDocNoConflict, type DuplicateDocNoConflict } from '../DuplicateDocNoDialog';
import type { MultiPartyDraft } from './partyDraft';
import { mergeExtra } from './woSteps';
import { sameDocOnSave } from './sameDocOnSave';
import { applyMulti, applyParties, isDone, taughtRow, type DocRow, type SavedRow } from './docRow';
import { loadRecentOwners, rememberOwner } from './recentOwners';
import { applyLiveLocks, liveLocksFor } from '../live/liveLocks';
import { useGramajCatalog, useGramajReseed, type GramajFor } from './useWoGramaj';
import {
  buildCreateBody,
  buildDraftPatch,
  draftResult,
  errorText,
  initialRowForm,
  isFormApprovalDisabled,
  isScanRoute,
  openedResult,
  resolveFormApproval,
  rowIssues,
  type FormApproval,
  type RowForm,
  type RowResult,
} from './woFromDoc';

// Eski içe aktarımlar (`./useWoRows`) için yeniden dışa aktarım; tanım servis katmanında.
export { INBOUND_DOC_SETTINGS_KEY };
// Satır tipi + saf dönüşümler `docRow.ts`te, gramaj kancaları `useWoGramaj.ts`te; eski içe aktarımlar için yeniden dışa aktarım.
export { taughtRow, type DocRow, type SavedRow } from './docRow';


interface SaveCtx {
  mode: FormApproval;
  /** null = rotasız (K29). */
  routeId: string | null;
  gramajPropertyId: string | null;
  /** K22 formda alanı olmayan çözücü değerleri (gövdeye aynen). */
  passThrough: readonly { propertyId: string; valueId: string }[];
  /** Belge masası plan makinesi için rotanın kurşun adımı sırası (yoksa makine gitmez). */
  kursunSequence: number | null;
  /** Satır anahtarlı deneme token'ı (belirsiz hatada yapışır). */
  token: string;
  /** K27 WARN: kullanıcı "Yine de onayla" dedi → gövdeye bayrak. */
  confirmDuplicateDocNo?: boolean;
  /** S16b tek form: formun ek alanları (hedef kumaş, en, metraj…); yok = bugünkü gövde. */
  extra?: ExtraFormBody;
}

/** Tek formun form ucuna eklediği alanlar (S16a sözleşmesi). */
export type ExtraFormBody = Partial<Omit<CreateWorkOrderFromNoteBody, 'clientToken' | 'ownerCustomerId' | 'kursunMeters'>>;

/** K27 WARN 409 bekleyen satır (diyalog bunu sorar). */
export interface DuplicateRow {
  noteId: string;
  conflict: DuplicateDocNoConflict;
}

async function saveDraft(r: DocRow, form: RowForm, disabledByServer: boolean): Promise<RowResult> {
  const patch = buildDraftPatch(form, r.detail!);
  if (Object.keys(patch).length) await inboundDocService.updateNote(r.noteId, patch);
  return draftResult(r.noteNo, disabledByServer);
}

/** Tek satır kaydı: ayrı onay kipinde taslak PATCH; değilse sözleşme 3 POST, sunucu "kapalı" derse taslağa düşer. */
async function saveRowOnce(ctx: SaveCtx, r: DocRow, form: RowForm): Promise<{ result: RowResult; error?: unknown }> {
  if (ctx.mode === 'SEPARATE') {
    try {
      return { result: await saveDraft(r, form, false) };
    } catch (e) {
      return { result: { kind: 'FAILED', text: errorText(e) } };
    }
  }
  const issues = rowIssues(form);
  if (issues.length) return { result: { kind: 'FAILED', text: issues.join(' ') } };
  try {
    const body = buildCreateBody(form, {
      clientToken: ctx.token,
      routeTemplateId: ctx.routeId,
      gramajPropertyId: ctx.gramajPropertyId,
      passThrough: ctx.passThrough,
      kursunSequence: ctx.kursunSequence,
    });
    const full = mergeExtra(body, ctx.extra);
    return { result: openedResult(await inboundDocService.createWorkOrder(r.noteId, ctx.confirmDuplicateDocNo ? { ...full, confirmDuplicateDocNo: true } : full)) };
  } catch (e) {
    if (!isFormApprovalDisabled(e)) return { result: { kind: 'FAILED', text: errorText(e) }, error: e };
    try {
      return { result: await saveDraft(r, form, true) };
    } catch (e2) {
      return { result: { kind: 'FAILED', text: errorText(e2) } };
    }
  }
}

/** Refakat kartı basımı; hata Toast'la duyurulur. Belge masası şeridi de bunu kullanır. */
export async function printCard(workOrderId: string): Promise<boolean> {
  try {
    await printTravelerCardForWorkOrder(workOrderId);
    return true;
  } catch (e) {
    Toast.show({ type: 'error', text1: 'Refakat kartı basılamadı', text2: errorText(e) });
    return false;
  }
}

function rowCounts(rows: DocRow[], ready: number) {
  return {
    total: rows.length,
    ready,
    reading: rows.filter((r) => !r.detail).length,
    opened: rows.filter((r) => r.result?.kind === 'OPENED').length,
    drafts: rows.filter((r) => r.result?.kind === 'DRAFT').length,
    failed: rows.filter((r) => r.result?.kind === 'FAILED').length,
  };
}

/** Satır düzenleyicileri (okuma → form, kullanıcı düzenlemesi, parti listesi); kayıt döngüsünden ayrı. */
function useRowMutators(setRows: Dispatch<SetStateAction<DocRow[]>>, gramajFor: GramajFor) {
  const addNote = useCallback((note: { id: string; noteNo: string }, runKey: number) => {
    setRows((rs) =>
      rs.some((r) => r.noteId === note.id)
        ? rs.map((r) => (r.noteId === note.id ? { ...r, runKey } : r))
        : [...rs, { noteId: note.id, noteNo: note.noteNo, runKey, detail: null, form: null, gramajTouched: false, result: null }],
    );
  }, [setRows]);

  const setDetail = useCallback(
    (noteId: string, detail: InboundNoteDetail) => {
      // Canlı okumanın kilitli değerleri okumayı ezer (operatör değeri) — forma giriş sınırı burası.
      const d = applyLiveLocks(detail, liveLocksFor(noteId));
      setRows((rs) => rs.map((r) => (r.noteId === noteId ? { ...r, detail: d, form: r.form ?? initialRowForm(d, gramajFor) } : r)));
    },
    [setRows, gramajFor],
  );

  const updateForm = useCallback(
    (noteId: string, patch: Partial<RowForm>) => {
      setRows((rs) =>
        rs.map((r) => {
          if (r.noteId !== noteId || !r.form) return r;
          const touched = r.gramajTouched || 'gramajValueId' in patch;
          // Müşteri değişti, gramaj elle seçilmedi → yeni müşterinin ön seçimi (cevap henüz yoksa reseed etkisi doldurur).
          const reseed = !touched && 'ownerCustomerId' in patch && patch.ownerCustomerId !== r.form.ownerCustomerId;
          const fresh = reseed ? gramajFor(patch.ownerCustomerId ?? null) : undefined;
          const next = fresh !== undefined ? { ...patch, gramajValueId: fresh } : patch;
          return { ...r, form: { ...r.form, ...next }, gramajTouched: touched, result: isDone(r) ? r.result : null };
        }),
      );
    },
    [setRows, gramajFor],
  );

  const setParties = useCallback((noteId: string, parties: NotePartiesView | null) => setRows((rs) => applyParties(rs, noteId, parties)), [setRows]);
  const setMulti = useCallback((noteId: string, multi: MultiPartyDraft) => setRows((rs) => applyMulti(rs, noteId, multi)), [setRows]);

  const removeRow = useCallback((noteId: string) => setRows((rs) => rs.filter((r) => r.noteId !== noteId)), [setRows]);
  // K30-A: belge yeni şablonla yeniden okutuldu → okuma baştan izlenir, form yeni okumadan kurulur.
  const rereadRow = useCallback(
    (noteId: string) => setRows((rs) => rs.map((r) => (r.noteId === noteId && !isDone(r) ? { ...r, runKey: r.runKey + 1, detail: null, form: null, parties: null, gramajTouched: false, result: null, taught: undefined } : r))),
    [setRows],
  );
  // K30-A: yeniden okutulamayan (satırlı) belgede tanıtma önizlemesinin değerleri forma dolar (sunucu yeniden okumaz).
  const applyTaught = useCallback(
    (noteId: string, fields: Record<string, string | null>, ownerCustomerId: string | null, tpl: { code: string; name: string }) =>
      setRows((rs) => rs.map((r) => (r.noteId === noteId ? taughtRow(r, fields, ownerCustomerId, tpl) : r))),
    [setRows],
  );
  return { addNote, setDetail, updateForm, setParties, setMulti, removeRow, rereadRow, applyTaught };
}

/** `extraBody`: S16b tek formun satır başına ek alanları (çok parti kipine göre değişir); verilmezse bugünkü gövde. */
export function useWoRows(route: ProductionRoute, opts?: { extraBody?: (r: DocRow) => ExtraFormBody }) {
  const attempt = useAttemptToken();
  const settings = useQuery({ queryKey: INBOUND_DOC_SETTINGS_KEY, queryFn: inboundDocService.settings, retry: false, staleTime: 60_000 });
  // `production.refakatAutoPrint` yalnız gelen belge ayar ucunda döner (bayrak yükünde yok); okunamazsa kapalı = elle basım.
  const autoPrint = settings.data?.refakatAutoPrint === true;
  const mode = resolveFormApproval(settings.data, settings.isError);
  const [rows, setRows] = useState<DocRow[]>([]);
  const { showGramaj, catalog, gramajFor, passThroughFor } = useGramajCatalog(route, rows);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => void loadRecentOwners().then(setRecent), []);

  useGramajReseed(setRows, gramajFor);

  const { addNote, setDetail, updateForm, setParties, setMulti, removeRow, rereadRow, applyTaught } = useRowMutators(setRows, gramajFor);
  const setResult = (noteId: string, result: RowResult) => setRows((rs) => rs.map((r) => (r.noteId === noteId ? { ...r, result } : r)));

  const printFor = async (noteId: string, workOrderId: string) => {
    const ok = await printCard(workOrderId);
    setRows((rs) => rs.map((r) => (r.noteId === noteId && r.result?.kind === 'OPENED' ? { ...r, result: { ...r.result, print: ok ? 'PRINTED' : 'PRINT_FAILED' } } : r)));
  };

  const pending = rows.filter((r) => r.form && r.detail && !isDone(r));
  // K27 WARN: işi süren aynı belge no'lu eş → satır FAILED kalır, diyalog sorar; onay yalnız o satırı bayrakla gönderir.
  const [duplicate, setDuplicate] = useState<DuplicateRow | null>(null);
  // K27 BLOCK: aynı belge no'lu eş → kısayol kartı (satır FAILED kalır).
  const [sameDoc, setSameDoc] = useState<SameDocumentMatch | null>(null);

  /** Dönüş: bu çağrıda kaydedilen satırların sonucu (çift dokunuşta / çevrimdışıyken boş). */
  const saveRows = async (targets: DocRow[], confirmNoteId: string | null): Promise<SavedRow[]> => {
    // Ref: çift dokunuşta `saving` durumu henüz güncellenmemiş olur — ikinci çağrı aynı satırı yeniden göndermesin.
    if (savingRef.current || targets.length === 0) return [];
    if (!onlineManager.isOnline()) {
      Toast.show({ type: 'error', text1: 'Sunucuya bağlantı yok', text2: 'Kayıt çevrimiçi yapılır; bağlantı gelince yeniden deneyin.' });
      return [];
    }
    savingRef.current = true;
    setSaving(true);
    const errors: unknown[] = [];
    const saved: SavedRow[] = [];
    let owners = recent;
    try {
      // Sırayla: her satır ayrı tx; biri düşerse diğerleri etkilenmez, sonuç satırda kalır.
      setDuplicate(null);
      for (const r of targets) {
        const ptNow = passThroughFor(r.form!.ownerCustomerId);
        const passThrough = Array.isArray(ptNow) ? ptNow : await ptNow;
        const ctx = { mode, routeId: isScanRoute(route) ? null : route.id, gramajPropertyId: catalog.propertyId, passThrough, kursunSequence: kursunStepOf(route)?.sequence ?? null, token: attempt.keyed(r.noteId), confirmDuplicateDocNo: r.noteId === confirmNoteId, extra: opts?.extraBody?.(r) };
        const { result, error } = await saveRowOnce(ctx, r, r.form!);
        if (error !== undefined) errors.push(error);
        const conflict = error === undefined ? null : duplicateDocNoConflict(error);
        if (conflict) setDuplicate((d) => d ?? { noteId: r.noteId, conflict });
        const same = error === undefined ? null : await sameDocOnSave(inboundDocService, error, { noteId: r.noteId, ownerCustomerId: r.form!.ownerCustomerId, senderDocNo: r.detail?.senderDocNo });
        if (same) setSameDoc((m) => m ?? same);
        setResult(r.noteId, result);
        saved.push({ noteId: r.noteId, noteNo: r.noteNo, result });
        if (result.kind !== 'FAILED' && r.form!.ownerCustomerId) owners = await rememberOwner(owners, r.form!.ownerCustomerId);
        if (result.kind === 'OPENED' && autoPrint) for (const w of result.workOrders) await printFor(r.noteId, w.workOrderId);
      }
    } finally {
      setRecent(owners);
      savingRef.current = false;
      setSaving(false);
    }
    // Deneme sonucu: belirsiz hata varsa satır token'ları yapışır (yeniden "Hepsini kaydet" aynı kaydı tekrarlamaz).
    if (errors.length) attempt.onFailure(errors.find(isAmbiguousFailure) ?? errors[0]);
    else attempt.onSuccess();
    return saved;
  };

  const saveAll = (): Promise<SavedRow[]> => saveRows(pending, null);

  const counts = useMemo(() => rowCounts(rows, pending.length), [rows, pending.length]);

  return {
    rows, mode, showGramaj, catalog, saving, recent, counts, autoPrint,
    /** İE partisinin numara kaynağı (ayar okunamadı/eski sunucu → null = "otomatik" gösterilir). */
    batchSource: settings.data?.batchNumberSource ?? null,
    addNote, setDetail, setParties, setMulti, updateForm, removeRow, rereadRow, applyTaught, saveAll,
    duplicate,
    dismissDuplicate: () => setDuplicate(null),
    sameDoc,
    dismissSameDoc: () => setSameDoc(null),
    /** Diyalogdaki "Yine de onayla": yalnız o satır, `confirmDuplicateDocNo: true` ile. */
    confirmDuplicate: (): Promise<SavedRow[]> => (duplicate ? saveRows(pending.filter((r) => r.noteId === duplicate.noteId), duplicate.noteId) : Promise.resolve([])),
    print: (noteId: string, workOrderId: string) => void printFor(noteId, workOrderId),
  };
}

export type WoRowsState = ReturnType<typeof useWoRows>;
