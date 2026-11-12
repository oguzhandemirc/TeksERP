// useUnifiedWoForm'un yan kancaları (kat ön seçimi, fason kart, tarayıcı akışı, sahip türü, rota kartı) —
// dosya boyu tavanı için ana kancadan ayrıldı; davranış aynı.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { preferredFoldCode, useFoldValues } from '../../../../hooks/useFoldValues';
import { inboundDocService, type DocIncomingDeclared } from '../../../../services/inboundDoc.service';
import { removePage, type ScanPage } from '../docScan';
import { useDocScan } from '../useDocScan';
import { usePageSource } from '../usePageSource';
import { createBlockReason, editExtras, initialFormState, resetForRoute, type WoFormExtras, type WoFormState } from './woForm';
import { routeService, type ProductionRoute } from '../../../../services/route.service';
import { useFeatureFlags } from '../../../../hooks/useFeatureFlags';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import type { DocRow, useWoRows } from './useWoRows';
import { rowIssueList } from './woFromDoc';
import { missingChips, type FormIssue } from './woIssues';
import { CUSTOMER_GOODS_TYPE, defaultWoTypeFor, type WoCreateKind } from '../../../../store/woCreateKinds';
import { ownerKindCard, woTypeForOwnerKind } from '../../IsEmirleri/createEntry';
import { fasonItemPrefill, hiddenTargetFields, sendsTargetColor } from './targetVisibility';

/** Tamburlu rotada ★'lı (yoksa ilk) kat ön seçilir (Hızlı İE ile aynı); rotasızda yalnız ★'lı değer gelir. */
export function useFoldDefault(hasTambur: boolean, scanRoute: boolean, setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
  const fold = useFoldValues();
  const pick = hasTambur ? preferredFoldCode(fold.values) : scanRoute ? (fold.values.find((v) => v.isDefault)?.code ?? null) : null;
  useEffect(() => {
    if (pick) setForm((s) => (s.extras.foldType ? s : { ...s, extras: { ...s.extras, foldType: pick } }));
  }, [pick, setForm]);
  return fold;
}

/** Okuma bitince belgeden gelenler forma dolar (aynı okuma bir kez; elle değiştirilen alan ezilmez); belge çıkınca temizlenir. */
/** Fason'da hedef kumaş sorulmaz: boşsa belgenin eşlenen kartı en öne yazılır (yoksa sunucu müşteri/İE varsayılan kartını uygular). */
export function useFasonItemPrefill(fason: boolean, targetItemId: string | null, declared: DocIncomingDeclared | undefined, setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
  useEffect(() => {
    const patch = fasonItemPrefill({ fason, extras: { targetItemId }, declared });
    if (patch) setForm((s) => (s.extras.targetItemId ? s : editExtras(s, patch)));
  }, [fason, targetItemId, declared, setForm]);
}

export type DocScanFlow = ReturnType<typeof useDocScanFlow>;

/** Tarayıcı akışı (DocBatchView kalıbı): sayfalar gelince yükleme + okuma kendiliğinden; biten belge satır olur. */
export function useDocScanFlow(addNote: ReturnType<typeof useWoRows>['addNote'], onNote?: (note: { id: string; noteNo: string }, runKey: number) => void) {
  const b = useDocScan({ successHint: 'Okuma bitince form dolar; kontrol edip oluşturun.' });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Okutulmuş belgenin sayfaları ("Belgeyi önizle"): gönderilen sayfaların yerel kopyası, salt görüntü.
  const [sentIndex, setSentIndex] = useState<number | null>(null);
  const onPages = (ps: ScanPage[]) => {
    const next = b.captureMany(ps);
    if (next) void b.send(next);
  };
  const source = usePageSource(b.pages.length, onPages);
  const doneNote = b.done?.note;
  const doneRun = b.done?.runKey ?? 0;
  const onNoteRef = React.useRef(onNote);
  onNoteRef.current = onNote;
  useEffect(() => {
    if (!doneNote) return;
    addNote(doneNote, doneRun);
    onNoteRef.current?.(doneNote, doneRun);
  }, [doneNote, doneRun, addNote]);
  const remove = (i: number) => b.setPages(removePage(b.pages, i));
  const removeFromPreview = (i: number) => {
    const left = b.pages.length - 1;
    remove(i);
    setPreviewIndex(left <= 0 ? null : Math.min(i, left - 1));
  };
  return {
    b,
    source,
    cameraOpen,
    openCamera: () => setCameraOpen(true),
    closeCamera: () => setCameraOpen(false),
    previewIndex,
    setPreviewIndex,
    sentIndex,
    setSentIndex,
    remove,
    removeFromPreview,
  };
}

/** "Belge Okut" girişi: tarayıcı bir kez kendiliğinden açılır (DocBatchView `autoStart` kalıbı). */
export function useAutoScan(enabled: boolean, add: () => void) {
  const started = React.useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    add();
  }, [enabled, add]);
}

/** "Malın sahibi" kartı: iki tür açık cihazda görünür ve seçim zorunlu; tek türde gizli, tür sabit (bugünkü). */
export function useOwnerKind(kinds: readonly WoCreateKind[] | undefined, woType: WoFormExtras['woType'], setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
  // Fason müşterisi rolü sistemde yok → ön seçim adı null (kart boş gelir); rol eklenince burası beslenir.
  const [init] = useState(() => ownerKindCard(kinds ?? [], null));
  const [value, setValue] = useState<WoCreateKind | null>(init.value);
  const visible = kinds !== undefined && init.visible;
  const choose = useCallback((k: WoCreateKind) => {
    setValue(k);
    setForm((s) => ({ ...s, extras: { ...s.extras, woType: woTypeForOwnerKind(k, s.extras.woType) } }));
  }, [setForm]);
  return { visible, value, reason: value !== null ? init.reason : null, choose, woType };
}

/** Müşterinin rota kartı (`rota-onerisi` CUSTOMER_ROUTE); yoksa / eski sunucu → null. */
export function useCardRoute(enabled: boolean, ownerId: string | null, routes: readonly ProductionRoute[]): ProductionRoute | null {
  const q = useQuery({
    queryKey: ['gelen-belge', 'rota-onerisi', ownerId],
    queryFn: () => inboundDocService.routeSuggestion(ownerId),
    enabled: enabled && !!ownerId,
    retry: false,
    staleTime: 60_000,
  });
  const s = q.data;
  if (!enabled || !ownerId || !s || s.source !== 'CUSTOMER_ROUTE' || !s.routeTemplateId) return null;
  return routes.find((r) => r.id === s.routeTemplateId) ?? null;
}

/** Rota + form durumu. Kullanıcının seçtiği rota (`setRoute`) dokunulmuş sayılır: kart rotası artık kendiliğinden uygulanmaz. */
export function useRouteAndForm(initialRoute: ProductionRoute | null) {
  const [route, setRouteState] = useState<ProductionRoute | null>(initialRoute);
  // Cihaz varsayılan türü (Seçenekler'de yalnız Fason açıksa Fason) — açılışta bir kez okunur.
  const [form, setForm] = useState<WoFormState>(() => initialFormState(defaultWoTypeFor(useDeviceSettingsStore.getState().woCreateKinds)));
  const [routeTouched, setRouteTouched] = useState(false);
  const applyRoute = useCallback((r: ProductionRoute) => {
    setRouteState(r);
    setForm(resetForRoute);
  }, []);
  const setRoute = useCallback((r: ProductionRoute) => {
    setRouteTouched(true);
    applyRoute(r);
  }, [applyRoute]);
  const edit = useCallback((patch: Partial<WoFormExtras>) => setForm((s) => editExtras(s, patch)), []);
  return { route, setRoute, applyRoute, routeTouched, form, setForm, edit };
}

/** Hedef metraj/kg ve en kutularının fabrika ayarı. */
export function useTargetFlags() {
  const flags = useFeatureFlags().data;
  return {
    showQuantity: flags?.targetQuantityEnabled === true,
    showWidth: flags?.targetWidthEnabled !== false, // eski sunucuda alan yok → açık
  };
}

/** Rota seçicinin listesi — rota formda değiştirilebilir (İş Emirleri girişi ön seçimli açar): kilitli değilse gerekir. */
export function useActiveRoutes(routeLocked: boolean) {
  return useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getActive(),
    staleTime: 10 * 60 * 1000,
    enabled: !routeLocked,
  });
}

interface GateInput {
  ownerMissing: boolean;
  ownMode: boolean;
  denied: readonly FormIssue[];
  row: DocRow | null;
  separate: boolean;
  done: boolean;
  extrasIssueList: readonly FormIssue[];
}

/** Saf: eksikler, "oluştur" engeli ve alt çubuk hapları. */
export function formGate({ ownerMissing, ownMode, denied, row, separate, done, extrasIssueList }: GateInput) {
  // Sıra = göz akışı: sol sütun (belgeden gelenler) önce, sonra sağ sütun (üretim kararı).
  // Malın sahibi seçimi eksikse diğer zorunlu alanlar gibi alt çubuk hapı (kartta hata çerçevesi yok).
  const issues: FormIssue[] = [
    ...(ownerMissing ? [{ key: 'malSahibi', text: 'Kendi Üretimimiz / Fason Üretim seçin.' } as FormIssue] : []),
    ...(ownMode ? denied : []),
    ...(row?.form && !separate && !ownMode ? rowIssueList(row.form) : []),
    ...extrasIssueList,
  ];
  const reading = !!row && (!row.form || !row.detail);
  // Kendi üretimde belge beklenmez: engel yalnız alanlardan (top da isteğe bağlı).
  const block = done ? null : createBlockReason({ hasDoc: ownMode || !!row, reading: reading && !ownMode, issues });
  // Alt çubuk hapları: belge yokken / okunurken hap yok (çubuk tek cümle söyler).
  const missing = done || (!ownMode && (!row || reading)) ? [] : missingChips(issues);
  // Engel cümlesi bir hapı aynen tekrarlıyorsa (yalnız müşteri) çubukta ikinci satır çizilmez.
  const blockKey = missing.length > 0 && block === issues[0]?.text ? issues[0].key : null;
  return { issues, reading, block, missing, blockKey };
}

/**
 * Kat tipi sorusu. Rotasızda tambura gidip gitmeyeceği bilinmez → kat tipi gramaj gibi görünür ama zorunlu değildir;
 * katalog boşsa (Kat özelliği pasif) seçilecek değer yoktur → engel de yoktur (sunucu kat tipini zorunlu tutmaz).
 */
export function useFoldAsk(hasTambur: boolean, scanRoute: boolean, setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
  const fold = useFoldDefault(hasTambur, scanRoute, setForm);
  return { fold, askFold: hasTambur || (scanRoute && fold.values.length > 0), foldRequired: hasTambur && fold.values.length > 0 };
}

/** Hedef kumaş/renk sorusunun görünürlüğü (kendi üretimde aynen görünür): Fason'da kumaş yok; renk sipariş/rota kuralıyla. */
export function useTargetVisibility(ownMode: boolean, extras: WoFormExtras, eff: ProductionRoute | null) {
  const orderLinked = extras.orderLineIds.length > 0;
  const hiddenTarget = useMemo(
    () => (ownMode ? [] : hiddenTargetFields({ fason: extras.woType === CUSTOMER_GOODS_TYPE, orderLinked, route: eff })),
    [ownMode, extras.woType, orderLinked, eff],
  );
  return { hiddenTarget, omitColor: !ownMode && !sendsTargetColor({ orderLinked, route: eff }) };
}
