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
import { SCAN_ROUTE, isScanRoute, rowIssues } from './woFromDoc';
import { multiPartyTotal } from './partyDraft';
import { rollsTotal } from './rollDraft';
import { effectiveRoute, sameAsRoute, stepsDropMachine, stepsFromRoute } from './woSteps';
import { TERIM } from '../../../../lib/terim';

export interface UnifiedWoFormProps {
  /** Özel iş emri karosundan açıldıysa ön seçili rota (rotasız dahil); düz karoda null = seçilir. */
  initialRoute: ProductionRoute | null;
  routeLocked: boolean;
  /** Açıldıktan sonra "Yeni iş emri": üst ekran formu sıfırdan kurar. */
  onNew: () => void;
}

/** Formun durumu: rota, ek alanlar, satır (tek belge), tarayıcı; belgeden doldurma ve "oluştur" engeli. */
export function useUnifiedWoForm({ initialRoute, routeLocked }: UnifiedWoFormProps) {
  const [route, setRouteState] = useState<ProductionRoute | null>(initialRoute);
  const [form, setForm] = useState<WoFormState>(initialFormState);
  const setRoute = useCallback((r: ProductionRoute) => {
    setRouteState(r);
    setForm(resetForRoute);
  }, []);
  const scanMode = useScanRouteMode();
  const showQuantity = useFeatureFlags().data?.targetQuantityEnabled === true;
  const routesQ = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 10 * 60 * 1000,
    enabled: initialRoute === null,
  });
  const extras = form.extras;
  const eff = useMemo(() => (route && !isScanRoute(route) ? effectiveRoute(route, extras.steps) : route), [route, extras.steps]);
  const hasTambur = useMemo(() => (eff?.steps ?? []).some((s) => s.station?.kind === 'TAMBUR'), [eff]);
  const fold = useFoldValues();
  // Kat yalnız tamburlu rotada sorulur; ilk katalog değeri ön seçilir (Hızlı İE ile aynı).
  const firstFold = fold.values[0]?.code ?? null;
  useEffect(() => {
    if (hasTambur && firstFold) setForm((s) => (s.extras.foldType ? s : { ...s, extras: { ...s.extras, foldType: firstFold } }));
  }, [hasTambur, firstFold]);

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
  const scan = useDocScanFlow(wo.addNote);
  useDocReadToForm(row, setForm);
  const edit = useCallback((patch: Partial<WoFormExtras>) => setForm((s) => editExtras(s, patch)), []);
  const hasRouteSteps = !!route && !isScanRoute(route) && (route.steps?.length ?? 0) > 0;
  const plan = buildPlanCtx({
    route, eff, extras, edit, routeLocked, hasRouteSteps, perParty,
    allMachines: ctx.data?.data.kursunMachines ?? [],
    stationRoutes: routesQ.data?.data ?? [],
    stationRoutesLoading: routesQ.isLoading,
    customerId: row?.form?.ownerCustomerId ?? null,
  });
  const fields = useWoFieldLayout(
    form,
    {
      showQuantity: showQuantity || !!extras.targetQuantity || !!extras.targetWeight,
      hasTambur,
      hasKursun: !!wo.showGramaj && wo.catalog.options.length > 0 && !!row?.form,
      hasRouteSteps,
      hasMachine: plan.machines.length > 0,
    },
    valuedFields(extras, { stepsEdited: plan.stepsEdited }),
  );

  // Gelen metre: çok partide parti toplamı, ayrı toplarda top toplamı, değilse kurşun metresi (sunucu türetmesiyle aynı kaynak).
  const incomingMeters = row?.form ? (row.form.multi ? multiPartyTotal(row.form.multi) : row.form.rolls ? rollsTotal(row.form.rolls) : row.form.meters) : null;
  const targetDerived = derivedTargetQuantity(extras, incomingMeters, { enabled: showQuantity, perParty });
  const done = row?.result?.kind === 'OPENED' || row?.result?.kind === 'DRAFT';
  const issues = [
    ...extrasIssues(extras, { routeChosen: !!route, hasTambur, perParty, inOther: fields.isOther }),
    ...(row?.form && wo.mode !== 'SEPARATE' ? rowIssues(row.form) : []),
  ];
  const block = done ? null : createBlockReason({ hasDoc: !!row, reading: !!row && (!row.form || !row.detail), issues });
  const okut = () => {
    if (row) {
      wo.removeRow(row.noteId);
      scan.b.finish();
      setForm(clearDocRead);
    }
    scan.source.add();
  };
  return {
    route, setRoute, form, fields, plan, scanMode, showQuantity, targetDerived, hasTambur, foldValues: fold.values, wo, row, scan, done, block, okut, customers, edit,
    customersLoading: ctx.isLoading,
    routes: routesQ.data?.data ?? [],
    routesLoading: routesQ.isLoading,
    onOrderLine: (l: AvailableOrderLine) => setForm((s) => applyOrderLine(s, { itemId: l.itemId, itemName: l.itemName, colorId: l.colorId, width: l.width })),
  };
}

// TERIM okuma anında çözülür (rejim değişebilir) → sabit değil fonksiyon.
const perPartyMachineNote = (): string =>
  `Her parti ayrı ${TERIM.terbiyeIsEmri.tekilKucuk} açıldığı için makine burada seçilmez; her ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} sonra seçilir.`;

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

/** K30-D plan bölümünün (adımlar, makine, tür, hedef özellik) bağlamı; PER_PARTY'de makine parti başına masada seçilir. */
function buildPlanCtx(p: PlanInput): WoPlanCtx {
  const { route, eff, extras, edit } = p;
  return {
    route: eff,
    steps: extras.steps ?? stepsFromRoute(route),
    stepsEdited: extras.steps !== null && !sameAsRoute(extras.steps, route),
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
    machineNote: p.perParty && machinesForRoute(eff, p.allMachines).length > 0 ? perPartyMachineNote() : null,
    machineValue: extras.machineId !== undefined ? extras.machineId : routeDefaultMachineId(eff, p.allMachines) ?? null,
    onMachine: (machineId) => edit({ machineId }),
    customerId: p.customerId,
    woType: extras.woType,
    orderLineIds: extras.orderLineIds,
    onWoType: (woType) => edit({ woType }),
    propertyIds: extras.propertyIds,
    onProperties: (propertyIds) => edit({ propertyIds }),
  };
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
function useDocScanFlow(addNote: ReturnType<typeof useWoRows>['addNote']) {
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
  useEffect(() => {
    if (doneNote) addNote(doneNote, doneRun);
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
