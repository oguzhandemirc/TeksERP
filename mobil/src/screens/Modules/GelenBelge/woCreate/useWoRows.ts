// Belgeden terbiye iş emri (K6/K7/K8) — satır listesi + "Hepsini kaydet". ONLINE-ONLY: kayıt top doğurur, kuyruğa alınmaz.
// Kip sunucu ayarından (formApproval); kapalıyken satır taslak olarak kalır (bugünkü ayrı onay). Satır başına sonuç.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { onlineManager, useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { isAmbiguousFailure } from '../../../../offline/entryAttempt';
import { fabricPropertyService, type KursunGramajCatalog } from '../../../../services/fabricProperty.service';
import { fetchDefaultTargets, passThroughTargets, useRouteDefaultTargets } from '../../../../hooks/useRouteDefaultTargets';
import { inboundDocService, type InboundNoteDetail, type NotePartiesView } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { printTravelerCardForWorkOrder } from '../../../../services/travelerCardPrint';
import { kursunStepOf } from '../desk/deskPlan';
import { initialMultiParty, type MultiPartyDraft } from './partyDraft';
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

export interface SavedRow {
  noteId: string;
  noteNo: string;
  result: RowResult;
}

const isDone = (r: DocRow): boolean => r.result?.kind === 'OPENED' || r.result?.kind === 'DRAFT';

interface SaveCtx {
  mode: FormApproval;
  routeId: string;
  gramajPropertyId: string | null;
  /** K22 formda alanı olmayan çözücü değerleri (gövdeye aynen). */
  passThrough: readonly { propertyId: string; valueId: string }[];
  /** Belge masası plan makinesi için rotanın kurşun adımı sırası (yoksa makine gitmez). */
  kursunSequence: number | null;
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
    const body = buildCreateBody(form, {
      clientToken: ctx.token,
      routeTemplateId: ctx.routeId,
      gramajPropertyId: ctx.gramajPropertyId,
      passThrough: ctx.passThrough,
      kursunSequence: ctx.kursunSequence,
    });
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

type GramajFor = (customerId: string | null) => string | null | undefined;
type PassThrough = readonly { propertyId: string; valueId: string }[];
/** Cevap hazırsa eşzamanlı (kayıt akışı mikro-görev kaybetmez), değilse doğrudan okunur. */
type PassThroughFor = (customerId: string | null) => PassThrough | Promise<PassThrough>;

/** Parti özeti form kurulduktan sonra gelir: çok partideyse satır listesi bir kez kurulur (kullanıcı düzenlemesi ezilmez). */
function applyParties(rs: DocRow[], noteId: string, parties: NotePartiesView | null): DocRow[] {
  return rs.map((r) => (r.noteId === noteId && r.form && r.parties === undefined ? { ...r, parties, form: { ...r.form, multi: initialMultiParty(parties) } } : r));
}

function applyMulti(rs: DocRow[], noteId: string, multi: MultiPartyDraft): DocRow[] {
  return rs.map((r) => (r.noteId === noteId && r.form && !isDone(r) ? { ...r, form: { ...r.form, multi }, result: null } : r));
}

/** Gramaj alanı yalnız rotada kurşun adımı varsa; katalog okunamazsa boş (alan çizilmez, uydurma yok). */
function useGramajCatalog(route: ProductionRoute, rows: DocRow[]): { showGramaj: boolean; catalog: KursunGramajCatalog; gramajFor: GramajFor; passThroughFor: PassThroughFor } {
  const showGramaj = routeHasKursunStep(route);
  const q = useQuery({
    queryKey: ['fabric-properties', 'kursun-gramaj-catalog'],
    queryFn: fabricPropertyService.getKursunGramajCatalog,
    enabled: showGramaj,
    retry: false,
    staleTime: 60_000,
  });
  const catalog = showGramaj ? q.data ?? EMPTY_CATALOG : EMPTY_CATALOG;
  // K22: ön seçim sunucu çözücüsünden (müşteri > istasyon yeteneği > değer varsayılanı); tablet kural yazmaz.
  // Kurşunsuz rotada da okunur: formda alanı olmayan seçim değerleri gövdeye aynen gider.
  const defaults = useRouteDefaultTargets(route, rows.map((r) => r.form?.ownerCustomerId ?? r.detail?.ownerCustomerId ?? null));
  const { valueFor } = defaults;
  const propertyId = catalog.propertyId;
  const gramajFor = useCallback<GramajFor>(
    (customerId) => {
      if (!showGramaj || !propertyId) return null;
      const id = valueFor(customerId, propertyId);
      // Katalogda olmayan (pasif) değer önerilmez.
      return id && !catalog.options.some((o) => o.id === id) ? null : id;
    },
    [showGramaj, propertyId, valueFor, catalog],
  );
  const gramajPropertyId = showGramaj ? propertyId : null;
  // Kayıt anında cevap henüz yoksa doğrudan okunur (kayıt beklemez); okunamazsa iletilecek değer yok.
  const passThroughFor = useCallback<PassThroughFor>(
    (customerId) =>
      defaults.passThroughFor(customerId, gramajPropertyId) ??
      (defaults.stationIds.length === 0 ? [] : fetchDefaultTargets(defaults.stationIds, customerId).then((l) => passThroughTargets(l, gramajPropertyId), () => [])),
    [defaults, gramajPropertyId],
  );
  return { showGramaj, catalog, gramajFor, passThroughFor };
}

/** Çözücü cevabı satırdan sonra gelirse (ya da müşteri değişince) dokunulmamış satırlara ön seçim düşer. */
function useGramajReseed(setRows: Dispatch<SetStateAction<DocRow[]>>, gramajFor: GramajFor): void {
  useEffect(() => {
    setRows((rs) => {
      let changed = false;
      const next = rs.map((r) => {
        if (!r.form || r.gramajTouched || isDone(r)) return r;
        const id = gramajFor(r.form.ownerCustomerId);
        if (id === undefined || id === r.form.gramajValueId) return r;
        changed = true;
        return { ...r, form: { ...r.form, gramajValueId: id } };
      });
      return changed ? next : rs;
    });
  }, [setRows, gramajFor]);
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
      setRows((rs) => rs.map((r) => (r.noteId === noteId ? { ...r, detail, form: r.form ?? initialRowForm(detail, gramajFor) } : r)));
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
  return { addNote, setDetail, updateForm, setParties, setMulti, removeRow };
}

export function useWoRows(route: ProductionRoute) {
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

  const { addNote, setDetail, updateForm, setParties, setMulti, removeRow } = useRowMutators(setRows, gramajFor);
  const setResult = (noteId: string, result: RowResult) => setRows((rs) => rs.map((r) => (r.noteId === noteId ? { ...r, result } : r)));

  const printFor = async (noteId: string, workOrderId: string) => {
    const ok = await printCard(workOrderId);
    setRows((rs) => rs.map((r) => (r.noteId === noteId && r.result?.kind === 'OPENED' ? { ...r, result: { ...r.result, print: ok ? 'PRINTED' : 'PRINT_FAILED' } } : r)));
  };

  const pending = rows.filter((r) => r.form && r.detail && !isDone(r));

  /** Dönüş: bu çağrıda kaydedilen satırların sonucu (çift dokunuşta / çevrimdışıyken boş). */
  const saveAll = async (): Promise<SavedRow[]> => {
    // Ref: çift dokunuşta `saving` durumu henüz güncellenmemiş olur — ikinci çağrı aynı satırı yeniden göndermesin.
    if (savingRef.current || pending.length === 0) return [];
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
      for (const r of pending) {
        const ptNow = passThroughFor(r.form!.ownerCustomerId);
        const passThrough = Array.isArray(ptNow) ? ptNow : await ptNow;
        const ctx = { mode, routeId: route.id, gramajPropertyId: catalog.propertyId, passThrough, kursunSequence: kursunStepOf(route)?.sequence ?? null, token: attempt.keyed(r.noteId) };
        const { result, error } = await saveRowOnce(ctx, r, r.form!);
        if (error !== undefined) errors.push(error);
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

  const counts = useMemo(() => rowCounts(rows, pending.length), [rows, pending.length]);

  return {
    rows, mode, showGramaj, catalog, saving, recent, counts, autoPrint,
    addNote, setDetail, setParties, setMulti, updateForm, removeRow, saveAll,
    print: (noteId: string, workOrderId: string) => void printFor(noteId, workOrderId),
  };
}

export type WoRowsState = ReturnType<typeof useWoRows>;
