// S16b tablet tek İE formunun ekran kancası (UnifiedWoForm'dan ayrıldı — dosya tavanı): rota, ek alanlar, tek belge
// satırı, tarayıcı, belgeden doldurma ve "oluştur" engeli. K30-D: düzenlenen adımlar "etkin rota" olur (gramaj,
// varsayılan hedef, tambur, makine buna göre çözülür); rota kimliği şablonunkidir.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PickerOption } from '../../../../components/PickerModal';
import { useFeatureFlags, useScanRouteMode } from '../../../../hooks/useFeatureFlags';
import { useFoldValues } from '../../../../hooks/useFoldValues';
import { inboundDocService, type DeskKursunMachine } from '../../../../services/inboundDoc.service';
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
import type { WoPlanCtx } from './WoPlanFields';
import {
  applyDocRead,
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
import { defaultWoTypeFor, type WoCreateKind } from '../../../../store/woCreateKinds';
import type { DocRowOpenRequest } from './DocRowCard';
import { useManualDraft } from './useManualDraft';
import { ownerKindCard, ownerKindForWoType, routeConflict, shouldApplyCardRoute, woTypeForOwnerKind } from '../../IsEmirleri/createEntry';

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
  const showQuantity = useFeatureFlags().data?.targetQuantityEnabled === true;
  const routesQ = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 10 * 60 * 1000,
    // Rota formda değiştirilebilir (İş Emirleri girişi ön seçimli açar): kilitli değilse liste gerekir.
    enabled: !routeLocked,
  });
  const extras = form.extras;
  const eff = useMemo(() => (route && !isScanRoute(route) ? effectiveRoute(route, extras.steps) : route), [route, extras.steps]);
  const hasTambur = useMemo(() => (eff?.steps ?? []).some((s) => s.station?.kind === 'TAMBUR'), [eff]);
  const fold = useFoldDefault(hasTambur, setForm);

  const extraBody = useCallback(
    (r: DocRow) => buildExtraBody(extras, { hasTambur, perParty: r.form?.multi?.mode === 'PER_PARTY', route: route && !isScanRoute(route) ? route : null }),
    [extras, hasTambur, route],
  );
  // Rota seçilmeden kayıt `extrasIssues` ile kapalıdır; kanca bir rota ister → yer tutucu.
  const wo = useWoRows(eff ?? SCAN_ROUTE, { extraBody });
  const row = wo.rows[0] ?? null;
  const perParty = row?.form?.multi?.mode === 'PER_PARTY';
  const ctx = useQuery({ queryKey: INBOUND_DOC_CONTEXT_KEY, queryFn: inboundDocService.tabletContext, staleTime: 60_000 });
  const customers: PickerOption[] = useMemo(() => (ctx.data?.data.customers ?? []).map((x) => ({ value: x.id, label: x.name })), [ctx.data]);
  const scan = useDocScanFlow(wo.addNote, onNote);
  const draft = useManualDraft(manual, (note) => { wo.markManual(note.id); scan.b.openNote(note); });
  useAutoScan(autoScan, scan.source.add);
  const owner = useOwnerKind(ownerKinds, extras.woType, setForm);
  const cardRoute = useCardRoute(ownerKinds !== undefined && !routeLocked, row?.form?.ownerCustomerId ?? null, routesQ.data?.data ?? []);
  useEffect(() => {
    if (shouldApplyCardRoute(route, routeTouched, cardRoute)) applyRoute(cardRoute!);
  }, [route, routeTouched, cardRoute, applyRoute]);
  const routeWarning = ownerKinds ? routeConflict(cardRoute, route) : null;
  useDocReadToForm(row, setForm);
  const edit = useCallback((patch: Partial<WoFormExtras>) => setForm((s) => editExtras(s, patch)), []);
  const hasRouteSteps = !!route && !isScanRoute(route) && (route.steps?.length ?? 0) > 0;
  const plan = buildPlanCtx({
    route, eff, extras, edit, routeLocked, hasRouteSteps, perParty,
    allMachines: ctx.data?.data.kursunMachines ?? [],
    stationRoutes: routesQ.data?.data ?? [],
    stationRoutesLoading: routesQ.isLoading,
    customerId: row?.form?.ownerCustomerId ?? null,
    onOwnerKind: owner.visible ? owner.sync : undefined,
  });
  const partyPlan = usePartyPlan({ row, wo, route: eff, allMachines: ctx.data?.data.kursunMachines ?? NO_MACHINES, stepsEdited: plan.stepsEdited });
  // Her parti ayrı + gramaj parti kartında: ortak gramaj alanı çizilmez (parti seçimi yoksa yine o gider).
  const partyGramaj = !!partyPlan && partyPlan.gramaj.length > 0;
  const fields = useWoFieldLayout(
    form,
    {
      showQuantity: showQuantity || !!extras.targetQuantity || !!extras.targetWeight,
      hasTambur,
      hasKursun: !!wo.showGramaj && wo.catalog.options.length > 0 && !!row?.form && !partyGramaj,
      hasRouteSteps,
      hasMachine: plan.machines.length > 0,
    },
    valuedFields(extras, { stepsEdited: plan.stepsEdited }),
    fieldsOpen !== undefined && onFieldsOpenChange ? { open: fieldsOpen, onOpenChange: onFieldsOpenChange } : undefined,
  );

  // Gelen metre: çok partide parti toplamı, ayrı toplarda top toplamı, değilse kurşun metresi (sunucu türetmesiyle aynı kaynak).
  const incomingMeters = row?.form ? (row.form.multi ? multiPartyTotal(row.form.multi) : row.form.rolls ? rollsTotal(row.form.rolls) : row.form.meters) : null;
  const targetDerived = derivedTargetQuantity(extras, incomingMeters, { enabled: showQuantity, perParty });
  const done = !!row && isDone(row);
  // Sıra = göz akışı: sol sütun (belgeden gelenler) önce, sonra sağ sütun (üretim kararı).
  const issues: FormIssue[] = [
    ...(row?.form && wo.mode !== 'SEPARATE' ? rowIssueList(row.form) : []),
    ...extrasIssues(extras, { routeChosen: !!route, hasTambur, perParty, inOther: fields.isOther }),
  ];
  const reading = !!row && (!row.form || !row.detail);
  const ownerBlock = owner.visible && owner.value === null ? 'Malın sahibini seçin' : null;
  const block = done ? null : createBlockReason({ hasDoc: !!row, reading, issues }) ?? ownerBlock;
  // Kaydedilen / taslak bırakılan / sayfa eklenen belgesiz taslak çıkışta silinmez.
  if (manual && row && (row.result || (scan.b.done?.pages ?? 0) > 0)) draft.keep();
  const addDoc = () => { scan.b.addToNote(); scan.source.add(); };
  // Alt çubuk hapları: belge yokken / okunurken hap yok (çubuk tek cümle söyler).
  const missing = done || !row || reading ? [] : missingChips(issues);
  const { okut, dropDoc } = docSlotActions(wo, row, scan, setForm);
  return {
    owner, routeWarning, manual, draft, addDoc,
    route, setRoute, form, fields, plan, partyPlan, partyGramaj, scanMode, showQuantity, targetDerived, hasTambur, foldValues: fold.values, wo, row, scan, done, block, missing, issues, reading, okut, dropDoc, customers, edit,
    customersLoading: ctx.isLoading,
    routes: routesQ.data?.data ?? [], routesLoading: routesQ.isLoading,
    onOrderLine: (l: AvailableOrderLine) => setForm((s) => applyOrderLine(s, { itemId: l.itemId, itemName: l.itemName, colorId: l.colorId, width: l.width })),
  };
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
  /** Tür seçici "Malın sahibi" kartını izletir. */
  onOwnerKind?: (k: WoCreateKind) => void;
}

/** K30-D plan bölümünün (adımlar, makine, tür, hedef özellik) bağlamı; PER_PARTY'de makine parti başına masada seçilir. */
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
    woType: extras.woType,
    orderLineIds: extras.orderLineIds,
    onWoType: (woType) => { edit({ woType }); p.onOwnerKind?.(ownerKindForWoType(woType)); },
    ownerCard: !!p.onOwnerKind,
    propertyIds: extras.propertyIds,
    onProperties: (propertyIds) => edit({ propertyIds }),
  };
}

/** Kat yalnız tamburlu rotada sorulur; ilk katalog değeri ön seçilir (Hızlı İE ile aynı). */
function useFoldDefault(hasTambur: boolean, setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
  const fold = useFoldValues();
  const firstFold = fold.values[0]?.code ?? null;
  useEffect(() => {
    if (hasTambur && firstFold) setForm((s) => (s.extras.foldType ? s : { ...s, extras: { ...s.extras, foldType: firstFold } }));
  }, [hasTambur, firstFold, setForm]);
  return fold;
}

/** Okuma bitince belgeden gelenler forma dolar (aynı okuma bir kez; elle değiştirilen alan ezilmez); belge çıkınca temizlenir. */
function useDocReadToForm(row: DocRow | null, setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
  const readKey = row?.detail ? `${row.noteId}#${row.runKey}#${row.taught?.seq ?? 0}` : null;
  const detail = row?.detail ?? null;
  useEffect(() => {
    if (readKey && detail) setForm((s) => applyDocRead(s, readKey, detail.formFields, detail.suggestions));
  }, [readKey, detail, setForm]);
  const hasRow = !!row;
  useEffect(() => {
    if (!hasRow) setForm((s) => (s.appliedNoteId ? clearDocRead(s) : s));
  }, [hasRow, setForm]);
}

export type DocScanFlow = ReturnType<typeof useDocScanFlow>;

/** Tarayıcı akışı (DocBatchView kalıbı): sayfalar gelince yükleme + okuma kendiliğinden; biten belge satır olur. */
function useDocScanFlow(addNote: ReturnType<typeof useWoRows>['addNote'], onNote?: (note: { id: string; noteNo: string }, runKey: number) => void) {
  const b = useDocScan({ successHint: 'Okuma bitince form dolar; kontrol edip oluşturun.' });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
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
  return { visible, value, reason: value !== null ? init.reason : null, choose, sync: setValue, woType };
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
