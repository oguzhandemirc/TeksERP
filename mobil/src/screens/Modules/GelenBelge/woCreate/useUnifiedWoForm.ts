// S16b tablet tek İE formunun ekran kancası (UnifiedWoForm'dan ayrıldı — dosya tavanı): rota, ek alanlar, tek belge
// satırı, tarayıcı, belgeden doldurma ve "oluştur" engeli. K30-D: düzenlenen adımlar "etkin rota" olur (gramaj,
// varsayılan hedef, tambur, makine buna göre çözülür); rota kimliği şablonunkidir.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PickerOption } from '../../../../components/PickerModal';
import { useFeatureFlags, useScanRouteMode } from '../../../../hooks/useFeatureFlags';
import { preferredFoldCode, useFoldValues } from '../../../../hooks/useFoldValues';
import { inboundDocService, type DeskKursunMachine, type DocIncomingDeclared } from '../../../../services/inboundDoc.service';
import type { AvailableOrderLine } from '../../../../services/order.service';
import { routeService, type ProductionRoute } from '../../../../services/route.service';
import { INBOUND_DOC_CONTEXT_KEY } from '../DocHeader';
import { machinesForRoute, routeDefaultMachineId } from '../desk/deskPlan';
import { removePage, type ScanPage } from '../docScan';
import { useDocScan } from '../useDocScan';
import { usePageSource } from '../usePageSource';
import { useWoRows, type DocRow } from './useWoRows';
import { isDone } from './docRow';
import { useWoFieldLayout } from './useWoFieldPrefs';
import { valuedFields } from './woFieldCatalog';
import { useTargetProps } from './targetProps';
import type { WoPlanCtx } from './WoPlanFields';
import {
  applyOrderLine,
  buildExtraBody,
  clearDocRead,
  createBlockReason,
  derivedTargetQuantity,
  editExtras,
  extrasIssues,
  initialFormState,
  resetForRoute,
  type WoFormExtras,
  type WoFormState,
} from './woForm';
import { SCAN_ROUTE, isScanRoute, rowIssueList } from './woFromDoc';
import { missingChips, type FormIssue } from './woIssues';
import { multiPartyTotal } from './partyDraft';
import { usePartyPlan } from './usePartyPlan';
import { rollsTotal } from './rollDraft';
import { effectiveRoute, sameAsRoute, stepsDropMachine, stepsFromRoute } from './woSteps';
import { TERIM } from '../../../../lib/terim';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import { CUSTOMER_GOODS_TYPE, defaultWoTypeFor, type WoCreateKind } from '../../../../store/woCreateKinds';
import type { DocRowOpenRequest } from './DocRowCard';
import { useManualDraft } from './useManualDraft';
import { ownerKindCard, routeConflict, shouldApplyCardRoute, woTypeForOwnerKind } from '../../IsEmirleri/createEntry';
import { isOwnGoodsMode } from './ownGoods';
import { showDerivedQuantity, targetHints } from './targetPrefill';
import { useDocReadToForm } from './useDocReadToForm';
import { fasonItemPrefill, hiddenTargetFields, sendsTargetColor } from './targetVisibility';
import { useOwnGoodsCreate } from './useOwnGoodsCreate';

export interface UnifiedWoFormProps {
  /** Özel iş emri karosundan açıldıysa ön seçili rota (rotasız dahil); düz karoda null = seçilir. */
  initialRoute: ProductionRoute | null;
  routeLocked: boolean;
  /** Açıldıktan sonra "Yeni iş emri": üst ekran formu sıfırdan kurar. */
  onNew: () => void;
  /** Verilirse ⚙ alan seçici açıklığı dışarıdan yönetilir ve gövdedeki "Alanlar" tuşu çizilmez. */
  fieldsOpen?: boolean;
  onFieldsOpenChange?: (open: boolean) => void;
  /** İş Emirleri girişi: cihazın İE türleri → "Malın sahibi" kartı (iki tür) + kart rotası önerisi; yoksa bugünkü form. */
  ownerKinds?: readonly WoCreateKind[];
  /** "Belge Okut": tarayıcı ek dokunuşsuz açılır. */
  autoScan?: boolean;
  /** "Elle Oluştur": belgesiz (sayfasız taslak) açılır; "Belge ekle" sonradan aynı taslağa sayfa ekler. */
  manual?: boolean;
  /** Gönderilen belge (okutma önizlemesi izler). */
  onNote?: (note: { id: string; noteNo: string }, runKey: number) => void;
  /** Satırın seçicisini dışarıdan aç (önizlemenin "Müşteri seç"i). */
  openRequest?: DocRowOpenRequest | null;
  /** Etkin mal sahibi türü değişti (başlık "Fason İş Emri" / "İş Emri"); tek türde de bir kez bildirilir. */
  onKindChange?: (kind: WoCreateKind | null) => void;
}

/** Formun durumu: rota, ek alanlar, satır (tek belge), tarayıcı; belgeden doldurma ve "oluştur" engeli. */
export function useUnifiedWoForm({ initialRoute, routeLocked, fieldsOpen, onFieldsOpenChange, ownerKinds, autoScan = false, manual = false, onNote }: UnifiedWoFormProps) {
  const [route, setRouteState] = useState<ProductionRoute | null>(initialRoute);
  // Cihaz varsayılan türü (Seçenekler'de yalnız Fason açıksa Fason) — açılışta bir kez okunur.
  const [form, setForm] = useState<WoFormState>(() => initialFormState(defaultWoTypeFor(useDeviceSettingsStore.getState().woCreateKinds)));
  const [routeTouched, setRouteTouched] = useState(false);
  const applyRoute = useCallback((r: ProductionRoute) => {
    setRouteState(r);
    setForm(resetForRoute);
  }, []);
  // Kullanıcının seçtiği rota: kart rotası artık kendiliğinden uygulanmaz.
  const setRoute = useCallback((r: ProductionRoute) => {
    setRouteTouched(true);
    applyRoute(r);
  }, [applyRoute]);
  const scanMode = useScanRouteMode();
  const flags = useFeatureFlags().data;
  const showQuantity = flags?.targetQuantityEnabled === true;
  const showWidth = flags?.targetWidthEnabled !== false; // eski sunucuda alan yok → açık
  const routesQ = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getActive(),
    staleTime: 10 * 60 * 1000,
    // Rota formda değiştirilebilir (İş Emirleri girişi ön seçimli açar): kilitli değilse liste gerekir.
    enabled: !routeLocked,
  });
  const extras = form.extras;
  const eff = useMemo(() => (route && !isScanRoute(route) ? effectiveRoute(route, extras.steps) : route), [route, extras.steps]);
  const hasTambur = useMemo(() => (eff?.steps ?? []).some((s) => s.station?.kind === 'TAMBUR'), [eff]);
  const fold = useFoldDefault(hasTambur, !!route && isScanRoute(route), setForm);
  // Rotasızda tambura gidip gitmeyeceği bilinmez → kat tipi gramaj gibi görünür ama zorunlu değildir; katalog boşsa
  // (Kat özelliği pasif) seçilecek değer yoktur → engel de yoktur (sunucu kat tipini zorunlu tutmaz, istasyon varsayılanı).
  const askFold = hasTambur || (!!route && isScanRoute(route) && fold.values.length > 0);
  const foldRequired = hasTambur && fold.values.length > 0;

  const owner = useOwnerKind(ownerKinds, extras.woType, setForm);
  // Hedef kumaş/renk sorusunun görünürlüğü (kendi üretimde aynen görünür): Fason'da kumaş yok; renk sipariş/rota kuralıyla.
  const ownModeEarly = isOwnGoodsMode(ownerKinds, owner.value);
  const orderLinked = extras.orderLineIds.length > 0;
  const hiddenTarget = useMemo(
    () => (ownModeEarly ? [] : hiddenTargetFields({ fason: extras.woType === CUSTOMER_GOODS_TYPE, orderLinked, route: eff })),
    [ownModeEarly, extras.woType, orderLinked, eff],
  );
  const omitColor = !ownModeEarly && !sendsTargetColor({ orderLinked, route: eff });
  // Kendi üretim (tek tür STANDARD ya da kartta seçili): belge taslağı yok, kayıt quick-start; kalemsiz tür açıkça Stoğa.
  const ownMode = ownModeEarly;
  const ownGoods = ownMode;
  const extraBody = useCallback(
    (r: DocRow) => buildExtraBody(extras, { hasTambur: askFold, perParty: r.form?.multi?.mode === 'PER_PARTY', route: route && !isScanRoute(route) ? route : null, ownGoods, omitColor, omitWidth: !showWidth, omitQuantity: !showQuantity }),
    [extras, askFold, route, ownGoods, omitColor, showWidth, showQuantity],
  );
  // Rota seçilmeden kayıt `extrasIssues` ile kapalıdır; kanca bir rota ister → yer tutucu.
  const wo = useWoRows(eff ?? SCAN_ROUTE, { extraBody });
  const row = wo.rows[0] ?? null;
  const perParty = row?.form?.multi?.mode === 'PER_PARTY';
  const ctx = useQuery({ queryKey: INBOUND_DOC_CONTEXT_KEY, queryFn: inboundDocService.tabletContext, staleTime: 60_000 });
  const customers: PickerOption[] = useMemo(() => (ctx.data?.data.customers ?? []).map((x) => ({ value: x.id, label: x.name })), [ctx.data]);
  const scan = useDocScanFlow(wo.addNote, onNote);
  const draft = useManualDraft(manual && !ownMode, (note) => { wo.markManual(note.id); scan.b.openNote(note); });
  useAutoScan(autoScan && !ownMode, scan.source.add);
  const realRoute = route && !isScanRoute(route) ? route : null;
  const own = useOwnGoodsCreate({ lockedItemId: extras.targetItemId, route, extraBody: () => buildExtraBody(extras, { hasTambur: askFold, route: realRoute, ownGoods: true, omitWidth: !showWidth, omitQuantity: !showQuantity }) });
  const cardRoute = useCardRoute(ownerKinds !== undefined && !routeLocked, row?.form?.ownerCustomerId ?? null, routesQ.data?.data ?? []);
  useEffect(() => {
    if (shouldApplyCardRoute(route, routeTouched, cardRoute)) applyRoute(cardRoute!);
  }, [route, routeTouched, cardRoute, applyRoute]);
  const routeWarning = ownerKinds ? routeConflict(cardRoute, route) : null;
  useFasonItemPrefill(!ownModeEarly && extras.woType === CUSTOMER_GOODS_TYPE, extras.targetItemId, row?.detail?.incomingDeclared, setForm);
  const edit = useCallback((patch: Partial<WoFormExtras>) => setForm((s) => editExtras(s, patch)), []);
  const hasRouteSteps = !!route && !isScanRoute(route) && (route.steps?.length ?? 0) > 0;
  const plan = buildPlanCtx({
    route, eff, extras, edit, routeLocked, hasRouteSteps, perParty,
    allMachines: ctx.data?.data.kursunMachines ?? [],
    stationRoutes: routesQ.data?.data ?? [],
    stationRoutesLoading: routesQ.isLoading,
    customerId: row?.form?.ownerCustomerId ?? null,
  });
  const targetProps = useTargetProps(plan.route, plan.customerId, hasRouteSteps);
  const partyPlan = usePartyPlan({ row, wo, route: eff, allMachines: ctx.data?.data.kursunMachines ?? NO_MACHINES, stepsEdited: plan.stepsEdited });
  // Her parti ayrı + gramaj parti kartında: ortak gramaj alanı çizilmez (parti seçimi yoksa yine o gider).
  const partyGramaj = !!partyPlan && partyPlan.gramaj.length > 0;
  const fields = useWoFieldLayout(
    form,
    {
      showQuantity,
      showWidth,
      hasTambur: askFold,
      hasKursun: !!wo.showGramaj && wo.catalog.options.length > 0 && !!row?.form && !partyGramaj,
      hasRouteSteps,
      hasMachine: plan.machines.length > 0,
      unavailable: hiddenTarget,
      noTargetProps: targetProps.empty,
    },
    valuedFields(extras, { stepsEdited: plan.stepsEdited }),
    fieldsOpen !== undefined && onFieldsOpenChange ? { open: fieldsOpen, onOpenChange: onFieldsOpenChange } : undefined,
  );

  // Gelen metre: çok partide parti toplamı, ayrı toplarda top toplamı, değilse kurşun metresi (sunucu türetmesiyle aynı kaynak).
  const incomingMeters = row?.form ? (row.form.multi ? multiPartyTotal(row.form.multi) : row.form.rolls ? rollsTotal(row.form.rolls) : row.form.meters) : null;
  const prefill = { fill: fields.prefs.fillTarget, widthEnabled: showWidth, quantityEnabled: showQuantity };
  useDocReadToForm(row, setForm, prefill);
  const targetDerived = derivedTargetQuantity(extras, incomingMeters, { enabled: showDerivedQuantity(prefill), perParty });
  const hints = targetHints(row?.detail?.formFields, prefill);
  const done = ownMode ? !!own.result : !!row && isDone(row);
  // Sıra = göz akışı: sol sütun (belgeden gelenler) önce, sonra sağ sütun (üretim kararı).
  // Malın sahibi seçimi eksikse diğer zorunlu alanlar gibi alt çubuk hapı (kartta hata çerçevesi yok).
  const ownerIssue: FormIssue[] = owner.visible && owner.value === null ? [{ key: 'malSahibi', text: 'Kendi Üretimimiz / Fason Üretim seçin.' }] : [];
  const issues: FormIssue[] = [
    ...ownerIssue,
    ...(row?.form && wo.mode !== 'SEPARATE' && !ownMode ? rowIssueList(row.form) : []),
    ...extrasIssues(extras, { routeChosen: !!route, hasTambur: foldRequired, perParty, inOther: fields.isOther }),
  ];
  const reading = !!row && (!row.form || !row.detail);
  // Kendi üretimde belge beklenmez: engel yalnız alanlardan (top da isteğe bağlı).
  const block = done ? null : createBlockReason({ hasDoc: ownMode || !!row, reading: reading && !ownMode, issues });
  // Kaydedilen / taslak bırakılan / sayfa eklenen belgesiz taslak çıkışta silinmez.
  if (manual && row && (row.result || (scan.b.done?.pages ?? 0) > 0)) draft.keep();
  const addDoc = () => { scan.b.addToNote(); scan.source.add(); };
  // Alt çubuk hapları: belge yokken / okunurken hap yok (çubuk tek cümle söyler).
  const missing = done || (!ownMode && (!row || reading)) ? [] : missingChips(issues);
  // Engel cümlesi bir hapı aynen tekrarlıyorsa (yalnız müşteri) çubukta ikinci satır çizilmez.
  const blockKey = missing.length > 0 && block === issues[0]?.text ? issues[0].key : null;
  const { okut, dropDoc } = docSlotActions(wo, row, scan, setForm);
  useDropDocOnOwnMode(ownMode, row?.noteId ?? null, dropDoc);
  return {
    owner, ownMode, own, routeWarning, manual, draft, addDoc,
    hiddenTarget, route, setRoute, form, fields, showWidth, hints, plan: { ...plan, stepNotesHidden: fields.prefs.stepNotesHidden }, partyPlan, partyGramaj, scanMode, showQuantity, targetDerived, hasTambur: askFold, foldValues: fold.values, wo, row, scan, done, block, blockKey, missing, issues, reading, okut, dropDoc, customers, edit,
    customersLoading: ctx.isLoading,
    routes: routesQ.data?.data ?? [], routesLoading: routesQ.isLoading,
    onOrderLine: (l: AvailableOrderLine) => setForm((s) => applyOrderLine(s, { itemId: l.itemId, itemName: l.itemName, colorId: l.colorId, width: l.width }, showWidth)),
  };
}

/** Kendi üretime geçildi: okutulmuş/belgesiz belge satırı formdan çıkar (belgesiz taslağı `useManualDraft` siler). */
function useDropDocOnOwnMode(ownMode: boolean, noteId: string | null, dropDoc: () => void) {
  const dropRef = React.useRef(dropDoc);
  dropRef.current = dropDoc;
  useEffect(() => {
    if (ownMode && noteId) dropRef.current();
  }, [ownMode, noteId]);
}

/** Belge sütununu boşalt: "Yeniden okut" tarayıcıyı açar; taslak iptal edilince (`dropDoc`) tarayıcı kendiliğinden açılmaz. */
function docSlotActions(
  wo: { removeRow: (noteId: string) => void },
  row: DocRow | null,
  scan: { b: { finish: () => void }; source: { add: () => void } },
  setForm: React.Dispatch<React.SetStateAction<WoFormState>>,
) {
  const dropDoc = () => {
    if (row) wo.removeRow(row.noteId);
    scan.b.finish();
    setForm(clearDocRead);
  };
  const okut = () => {
    if (row) dropDoc();
    scan.source.add();
  };
  return { okut, dropDoc };
}

// TERIM okuma anında çözülür (rejim değişebilir) → sabit değil fonksiyon.
const perPartyMachineNote = (stepsEdited: boolean): string =>
  `Her parti ayrı ${TERIM.terbiyeIsEmri.tekilKucuk} olur; makine ${stepsEdited ? 'sonra seçilir' : 'parti kartlarında seçilir'}.`;
const NO_MACHINES: readonly DeskKursunMachine[] = [];

interface PlanInput {
  route: ProductionRoute | null;
  eff: ProductionRoute | null;
  extras: WoFormExtras;
  edit: (patch: Partial<WoFormExtras>) => void;
  routeLocked: boolean;
  hasRouteSteps: boolean;
  perParty: boolean;
  allMachines: readonly DeskKursunMachine[];
  stationRoutes: ProductionRoute[];
  stationRoutesLoading: boolean;
  customerId: string | null;
}

/** K30-D plan bölümünün (adımlar, makine, hedef özellik) bağlamı; PER_PARTY'de makine parti başına masada seçilir. */
function buildPlanCtx(p: PlanInput): WoPlanCtx {
  const { route, eff, extras, edit } = p;
  const stepsEdited = extras.steps !== null && !sameAsRoute(extras.steps, route);
  return {
    route: eff,
    steps: extras.steps ?? stepsFromRoute(route),
    stepsEdited,
    showSteps: p.hasRouteSteps,
    stepsEditable: !p.routeLocked,
    // Kurşun adımı çıkarıldı/değişti → seçilen makine o istasyona ait değil: karar sıfırlanır (şablon/öneri yeniden).
    onSteps: (steps) => {
      const before = extras.steps ?? stepsFromRoute(route);
      edit(stepsDropMachine(before, steps ?? stepsFromRoute(route)) ? { steps, machineId: undefined } : { steps });
    },
    stationRoutes: p.stationRoutes,
    stationRoutesLoading: p.stationRoutesLoading,
    machines: p.perParty ? [] : machinesForRoute(eff, p.allMachines),
    machineNote: p.perParty && machinesForRoute(eff, p.allMachines).length > 0 ? perPartyMachineNote(stepsEdited) : null,
    machineValue: extras.machineId !== undefined ? extras.machineId : routeDefaultMachineId(eff, p.allMachines) ?? null,
    onMachine: (machineId) => edit({ machineId }),
    customerId: p.customerId,
    propertyIds: extras.propertyIds,
    onProperties: (propertyIds) => edit({ propertyIds }),
  };
}

/** Tamburlu rotada ★'lı (yoksa ilk) kat ön seçilir (Hızlı İE ile aynı); rotasızda yalnız ★'lı değer gelir. */
function useFoldDefault(hasTambur: boolean, scanRoute: boolean, setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
  const fold = useFoldValues();
  const pick = hasTambur ? preferredFoldCode(fold.values) : scanRoute ? (fold.values.find((v) => v.isDefault)?.code ?? null) : null;
  useEffect(() => {
    if (pick) setForm((s) => (s.extras.foldType ? s : { ...s, extras: { ...s.extras, foldType: pick } }));
  }, [pick, setForm]);
  return fold;
}

/** Okuma bitince belgeden gelenler forma dolar (aynı okuma bir kez; elle değiştirilen alan ezilmez); belge çıkınca temizlenir. */
/** Fason'da hedef kumaş sorulmaz: boşsa belgenin eşlenen kartı en öne yazılır (yoksa sunucu müşteri/İE varsayılan kartını uygular). */
function useFasonItemPrefill(fason: boolean, targetItemId: string | null, declared: DocIncomingDeclared | undefined, setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
  useEffect(() => {
    const patch = fasonItemPrefill({ fason, extras: { targetItemId }, declared });
    if (patch) setForm((s) => (s.extras.targetItemId ? s : editExtras(s, patch)));
  }, [fason, targetItemId, declared, setForm]);
}

export type DocScanFlow = ReturnType<typeof useDocScanFlow>;

/** Tarayıcı akışı (DocBatchView kalıbı): sayfalar gelince yükleme + okuma kendiliğinden; biten belge satır olur. */
function useDocScanFlow(addNote: ReturnType<typeof useWoRows>['addNote'], onNote?: (note: { id: string; noteNo: string }, runKey: number) => void) {
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
function useAutoScan(enabled: boolean, add: () => void) {
  const started = React.useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    add();
  }, [enabled, add]);
}

/** "Malın sahibi" kartı: iki tür açık cihazda görünür ve seçim zorunlu; tek türde gizli, tür sabit (bugünkü). */
function useOwnerKind(kinds: readonly WoCreateKind[] | undefined, woType: WoFormExtras['woType'], setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
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
function useCardRoute(enabled: boolean, ownerId: string | null, routes: readonly ProductionRoute[]): ProductionRoute | null {
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
