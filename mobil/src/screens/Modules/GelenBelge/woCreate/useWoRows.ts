// Belgeden terbiye iş emri (K6/K7/K8) — satır listesi + "Hepsini kaydet". ONLINE-ONLY: kayıt top doğurur, kuyruğa alınmaz.
// Kip sunucu ayarından (formApproval); kapalıyken satır taslak olarak kalır (bugünkü ayrı onay). Satır başına sonuç.
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { onlineManager, useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { isAmbiguousFailure } from '../../../../offline/entryAttempt';
import { fabricPropertyService, type KursunCustomerDefaults, type KursunGramajCatalog } from '../../../../services/fabricProperty.service';
import { inboundDocService, type InboundNoteDetail, type NotePartiesView } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { printTravelerCardForWorkOrder } from '../../../../services/travelerCardPrint';
import { initialMultiParty, type MultiPartyDraft } from './partyDraft';
import { loadRecentOwners, rememberOwner } from './recentOwners';
import {
  buildCreateBody,
  buildDraftPatch,
  customerGramajId,
  draftResult,
  errorText,
  initialRowForm,
  isFormApprovalDisabled,
  openedResult,
  resolveFormApproval,
  routeHasKursunStep,
  rowIssues,
  type FormApproval,
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
  /** S1 parti özeti (çok partili belgede liste + uyarılar); yok = tek partili form. */
  parties?: NotePartiesView | null;
}

const EMPTY_CATALOG: KursunGramajCatalog = { propertyId: null, options: [] };
export const INBOUND_DOC_SETTINGS_KEY = ['gelen-belge', 'ayarlar'] as const;

const isDone = (r: DocRow): boolean => r.result?.kind === 'OPENED' || r.result?.kind === 'DRAFT';

interface SaveCtx {
  mode: FormApproval;
  routeId: string;
  gramajPropertyId: string | null;
  /** Satır anahtarlı deneme token'ı (belirsiz hatada yapışır). */
  token: string;
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
    const body = buildCreateBody(form, { clientToken: ctx.token, routeTemplateId: ctx.routeId, gramajPropertyId: ctx.gramajPropertyId });
    return { result: openedResult(await inboundDocService.createWorkOrder(r.noteId, body)) };
  } catch (e) {
    if (!isFormApprovalDisabled(e)) return { result: { kind: 'FAILED', text: errorText(e) }, error: e };
    try {
      return { result: await saveDraft(r, form, true) };
    } catch (e2) {
      return { result: { kind: 'FAILED', text: errorText(e2) } };
    }
  }
}

async function printCard(workOrderId: string): Promise<boolean> {
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

/** Parti özeti form kurulduktan sonra gelir: çok partideyse satır listesi bir kez kurulur (kullanıcı düzenlemesi ezilmez). */
function applyParties(rs: DocRow[], noteId: string, parties: NotePartiesView | null): DocRow[] {
  return rs.map((r) => (r.noteId === noteId && r.form && r.parties === undefined ? { ...r, parties, form: { ...r.form, multi: initialMultiParty(parties) } } : r));
}

function applyMulti(rs: DocRow[], noteId: string, multi: MultiPartyDraft): DocRow[] {
  return rs.map((r) => (r.noteId === noteId && r.form && !isDone(r) ? { ...r, form: { ...r.form, multi }, result: null } : r));
}

/** Gramaj alanı yalnız rotada kurşun adımı varsa; katalog okunamazsa boş (alan çizilmez, uydurma yok). */
const NO_DEFAULTS: KursunCustomerDefaults = Object.freeze({});

function useGramajCatalog(route: ProductionRoute): { showGramaj: boolean; catalog: KursunGramajCatalog; defaults: KursunCustomerDefaults } {
  const showGramaj = routeHasKursunStep(route);
  const q = useQuery({
    queryKey: ['fabric-properties', 'kursun-gramaj-catalog'],
    queryFn: fabricPropertyService.getKursunGramajCatalog,
    enabled: showGramaj,
    retry: false,
    staleTime: 60_000,
  });
  // S3: müşterinin cari kartındaki varsayılan gramajı (yalnız ön seçim).
  const d = useQuery({
    queryKey: ['work-orders', 'kursun-customer-defaults'],
    queryFn: fabricPropertyService.getKursunCustomerDefaults,
    enabled: showGramaj,
    retry: false,
    staleTime: 60_000,
  });
  return { showGramaj, catalog: showGramaj ? q.data ?? EMPTY_CATALOG : EMPTY_CATALOG, defaults: d.data ?? NO_DEFAULTS };
}

/** Katalog / müşteri varsayılanları satırdan sonra gelirse dokunulmamış satırlara ön seçim düşer (müşterininki, yoksa istasyonunki). */
function useGramajReseed(setRows: Dispatch<SetStateAction<DocRow[]>>, catalog: KursunGramajCatalog, defaults: KursunCustomerDefaults): void {
  useEffect(() => {
    if (catalog.options.length === 0) return;
    setRows((rs) =>
      rs.map((r) => {
        if (!r.form || r.gramajTouched || isDone(r)) return r;
        const id = customerGramajId(catalog, defaults, r.form.ownerCustomerId);
        return id && id !== r.form.gramajValueId ? { ...r, form: { ...r.form, gramajValueId: id } } : r;
      }),
    );
  }, [setRows, catalog, defaults]);
}

export function useWoRows(route: ProductionRoute) {
  const attempt = useAttemptToken();
  const settings = useQuery({ queryKey: INBOUND_DOC_SETTINGS_KEY, queryFn: inboundDocService.settings, retry: false, staleTime: 60_000 });
  // `production.refakatAutoPrint` yalnız gelen belge ayar ucunda döner (bayrak yükünde yok); okunamazsa kapalı = elle basım.
  const autoPrint = settings.data?.refakatAutoPrint === true;
  const mode = resolveFormApproval(settings.data, settings.isError);
  const { showGramaj, catalog, defaults } = useGramajCatalog(route);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => void loadRecentOwners().then(setRecent), []);

  useGramajReseed(setRows, catalog, defaults);

  const addNote = useCallback((note: { id: string; noteNo: string }, runKey: number) => {
    setRows((rs) =>
      rs.some((r) => r.noteId === note.id)
        ? rs.map((r) => (r.noteId === note.id ? { ...r, runKey } : r))
        : [...rs, { noteId: note.id, noteNo: note.noteNo, runKey, detail: null, form: null, gramajTouched: false, result: null }],
    );
  }, []);

  const setDetail = useCallback(
    (noteId: string, detail: InboundNoteDetail) => {
      setRows((rs) => rs.map((r) => (r.noteId === noteId ? { ...r, detail, form: r.form ?? initialRowForm(detail, catalog, showGramaj, defaults) } : r)));
    },
    [catalog, showGramaj, defaults],
  );

  const updateForm = useCallback(
    (noteId: string, patch: Partial<RowForm>) => {
      setRows((rs) =>
        rs.map((r) => {
          if (r.noteId !== noteId || !r.form) return r;
          const touched = r.gramajTouched || 'gramajValueId' in patch;
          // S3: müşteri değişti, gramaj elle seçilmedi → yeni müşterinin varsayılanı (yoksa istasyonunki).
          const reseed = !touched && showGramaj && 'ownerCustomerId' in patch && patch.ownerCustomerId !== r.form.ownerCustomerId;
          const next = reseed ? { ...patch, gramajValueId: customerGramajId(catalog, defaults, patch.ownerCustomerId ?? null) } : patch;
          return { ...r, form: { ...r.form, ...next }, gramajTouched: touched, result: isDone(r) ? r.result : null };
        }),
      );
    },
    [catalog, defaults, showGramaj],
  );

  const setParties = useCallback((noteId: string, parties: NotePartiesView | null) => setRows((rs) => applyParties(rs, noteId, parties)), []);
  const setMulti = useCallback((noteId: string, multi: MultiPartyDraft) => setRows((rs) => applyMulti(rs, noteId, multi)), []);

  const removeRow = useCallback((noteId: string) => setRows((rs) => rs.filter((r) => r.noteId !== noteId)), []);
  const setResult = (noteId: string, result: RowResult) => setRows((rs) => rs.map((r) => (r.noteId === noteId ? { ...r, result } : r)));

  const printFor = async (noteId: string, workOrderId: string) => {
    const ok = await printCard(workOrderId);
    setRows((rs) => rs.map((r) => (r.noteId === noteId && r.result?.kind === 'OPENED' ? { ...r, result: { ...r.result, print: ok ? 'PRINTED' : 'PRINT_FAILED' } } : r)));
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
        const { result, error } = await saveRowOnce({ mode, routeId: route.id, gramajPropertyId: catalog.propertyId, token: attempt.keyed(r.noteId) }, r, r.form!);
        if (error !== undefined) errors.push(error);
        setResult(r.noteId, result);
        if (result.kind !== 'FAILED' && r.form!.ownerCustomerId) owners = await rememberOwner(owners, r.form!.ownerCustomerId);
        if (result.kind === 'OPENED' && autoPrint) for (const w of result.workOrders) await printFor(r.noteId, w.workOrderId);
      }
    } finally {
      setRecent(owners);
      setSaving(false);
    }
    // Deneme sonucu: belirsiz hata varsa satır token'ları yapışır (yeniden "Hepsini kaydet" aynı kaydı tekrarlamaz).
    if (errors.length) attempt.onFailure(errors.find(isAmbiguousFailure) ?? errors[0]);
    else attempt.onSuccess();
  };

  const counts = useMemo(() => rowCounts(rows, pending.length), [rows, pending.length]);

  return {
    rows, mode, showGramaj, catalog, saving, recent, counts, autoPrint,
    addNote, setDetail, setParties, setMulti, updateForm, removeRow, saveAll,
    print: (noteId: string, workOrderId: string) => void printFor(noteId, workOrderId),
  };
}

export type WoRowsState = ReturnType<typeof useWoRows>;
