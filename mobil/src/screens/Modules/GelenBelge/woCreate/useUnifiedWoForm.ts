// S16b tablet tek İE formunun ekran kancası (UnifiedWoForm'dan ayrıldı — dosya tavanı): rota, ek alanlar, tek belge
// satırı, tarayıcı, belgeden doldurma ve "oluştur" engeli. K30-D: düzenlenen adımlar "etkin rota" olur (gramaj,
// varsayılan hedef, tambur, makine buna göre çözülür); rota kimliği şablonunkidir.
import React, { useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PickerOption } from '../../../../components/PickerModal';
import { useScanRouteMode } from '../../../../hooks/useFeatureFlags';
import { inboundDocService, type DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { AvailableOrderLine } from '../../../../services/order.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { INBOUND_DOC_CONTEXT_KEY } from '../DocHeader';
import { machinesForRoute, routeDefaultMachineId } from '../desk/deskPlan';
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
  derivedTargetQuantity,
  extrasIssues,
  type WoFormExtras,
  type WoFormState,
} from './woForm';
import { SCAN_ROUTE, isScanRoute } from './woFromDoc';
import { multiPartyTotal } from './partyDraft';
import { usePartyPlan } from './usePartyPlan';
import { rollsTotal } from './rollDraft';
import { effectiveRoute, sameAsRoute, stepsDropMachine, stepsFromRoute } from './woSteps';
import { TERIM } from '../../../../lib/terim';
import { CUSTOMER_GOODS_TYPE, type WoCreateKind } from '../../../../store/woCreateKinds';
import type { DocRowOpenRequest } from './DocRowCard';
import { useManualDraft } from './useManualDraft';
import { routeConflict, shouldApplyCardRoute } from '../../IsEmirleri/createEntry';
import { isOwnGoodsMode } from './ownGoods';
import { showDerivedQuantity, targetHints } from './targetPrefill';
import { useDocReadToForm } from './useDocReadToForm';
import { useOwnGoodsCreate } from './useOwnGoodsCreate';
import {
  formGate, useActiveRoutes, useAutoScan, useCardRoute, useDocScanFlow, useFasonItemPrefill, useFoldAsk, useOwnerKind, useRouteAndForm,
  useTargetFlags, useTargetVisibility,
} from './woFormHooks';

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
  const { route, setRoute, applyRoute, routeTouched, form, setForm, edit } = useRouteAndForm(initialRoute);
  const scanMode = useScanRouteMode();
  const { showQuantity, showWidth } = useTargetFlags();
  const routesQ = useActiveRoutes(routeLocked);
  const extras = form.extras;
  const eff = useMemo(() => (route && !isScanRoute(route) ? effectiveRoute(route, extras.steps) : route), [route, extras.steps]);
  const hasTambur = useMemo(() => (eff?.steps ?? []).some((s) => s.station?.kind === 'TAMBUR'), [eff]);
  const { fold, askFold, foldRequired } = useFoldAsk(hasTambur, !!route && isScanRoute(route), setForm);

  const owner = useOwnerKind(ownerKinds, extras.woType, setForm);
  const ownModeEarly = isOwnGoodsMode(ownerKinds, owner.value);
  const { hiddenTarget, omitColor } = useTargetVisibility(ownModeEarly, extras, eff);
  // Kendi üretim (tek tür STANDARD ya da kartta seçili): belge taslağı yok, kayıt quick-start; kalemsiz tür açıkça Stoğa.
  const ownMode = ownModeEarly;
  const extraBody = useCallback(
    (r: DocRow) => buildExtraBody(extras, { hasTambur: askFold, perParty: r.form?.multi?.mode === 'PER_PARTY', route: route && !isScanRoute(route) ? route : null, ownGoods: ownMode, omitColor, omitWidth: !showWidth, omitQuantity: !showQuantity }),
    [extras, askFold, route, ownMode, omitColor, showWidth, showQuantity],
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
  const own = useOwnGoodsCreate({ lockedItemId: extras.targetItemId, route, extraBody: () => buildExtraBody(extras, { hasTambur: askFold, route: route && !isScanRoute(route) ? route : null, ownGoods: true, omitWidth: !showWidth, omitQuantity: !showQuantity }) });
  const cardRoute = useCardRoute(ownerKinds !== undefined && !routeLocked, row?.form?.ownerCustomerId ?? null, routesQ.data?.data ?? []);
  useEffect(() => {
    if (shouldApplyCardRoute(route, routeTouched, cardRoute)) applyRoute(cardRoute!);
  }, [route, routeTouched, cardRoute, applyRoute]);
  const routeWarning = ownerKinds ? routeConflict(cardRoute, route) : null;
  useFasonItemPrefill(!ownModeEarly && extras.woType === CUSTOMER_GOODS_TYPE, extras.targetItemId, row?.detail?.incomingDeclared, setForm);
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
  const { issues, reading, block, missing, blockKey } = formGate({
    ownerMissing: owner.visible && owner.value === null, ownMode, denied: own.denied, row, separate: wo.mode === 'SEPARATE', done,
    extrasIssueList: extrasIssues(extras, { routeChosen: !!route, hasTambur: foldRequired, perParty, inOther: fields.isOther }),
  });
  // Kaydedilen / taslak bırakılan / sayfa eklenen belgesiz taslak çıkışta silinmez.
  if (manual && row && (row.result || (scan.b.done?.pages ?? 0) > 0)) draft.keep();
  const addDoc = () => { scan.b.addToNote(); scan.source.add(); };
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

export type { DocScanFlow } from './woFormHooks';
