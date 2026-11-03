// S16b tablet TEK iş emri formu (`gelenBelge.tabletIeGirisi = BELGE`): her İE karosu bu formu açar (özel İE = rota
// hazır). Üstte "Belge okut" → okunan değerler inputlara dolar → görevli kontrol eder → "İş emri oluştur" (form ucu).
// Müşteri / parti / kurşun metresi / gramaj / çok parti bugünkü satır kartından (DocRowCard) gelir; üretim + plan
// inputları WoFormFields'ta. Kayıt `useWoRows` + satır başına ek gövde alanlarıyla (S16a sözleşmesi).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import type { PickerOption } from '../../../../components/PickerModal';
import { SheetField } from '../../../../components/ModuleSheet';
import { useFeatureFlags, useScanRouteMode } from '../../../../hooks/useFeatureFlags';
import { useFoldValues } from '../../../../hooks/useFoldValues';
import { TERIM } from '../../../../lib/terim';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import type { AvailableOrderLine } from '../../../../services/order.service';
import { routeService, type ProductionRoute } from '../../../../services/route.service';
import { colors, spacing, typography } from '../../../../theme';
import { INBOUND_DOC_CONTEXT_KEY } from '../DocHeader';
import { DuplicateDocNoDialog } from '../DuplicateDocNoDialog';
import PageCameraModal from '../PageCameraModal';
import PagePreviewModal from '../PagePreviewModal';
import { removePage, type ScanPage } from '../docScan';
import { useDocScan } from '../useDocScan';
import { usePageSource } from '../usePageSource';
import { ScannerSection } from './DocBatchView';
import DocRowCard, { GramajField } from './DocRowCard';
import { useWoRows, type DocRow, type WoRowsState } from './useWoRows';
import WoFormFields from './WoFormFields';
import { FieldSelectorSheet, FieldsButton, OtherFields } from './WoFieldSelector';
import { useWoFieldLayout } from './useWoFieldPrefs';
import {
  applyDocRead,
  applyOrderLine,
  buildExtraBody,
  clearDocRead,
  createBlockReason,
  editExtras,
  extrasIssues,
  initialFormState,
  type WoFormExtras,
  type WoFormState,
} from './woForm';
import { SCAN_ROUTE, rowIssues } from './woFromDoc';

interface Props {
  /** Özel iş emri karosundan açıldıysa ön seçili rota (rotasız dahil); düz karoda null = seçilir. */
  initialRoute: ProductionRoute | null;
  routeLocked: boolean;
  /** Açıldıktan sonra "Yeni iş emri": üst ekran formu sıfırdan kurar. */
  onNew: () => void;
}

const DOC_PLACEHOLDER = 'Belge okutulunca dolar';

export default function UnifiedWoForm(props: Props) {
  const u = useUnifiedWoForm(props);
  const { wo, row, scan, form, done, fields } = u;
  const fieldProps = {
    state: form,
    edit: u.edit,
    route: u.route,
    routeLocked: props.routeLocked,
    onRoute: u.setRoute,
    routes: u.routes,
    routesLoading: u.routesLoading,
    scanMode: u.scanMode,
    hasTambur: u.hasTambur,
    foldValues: u.foldValues,
    showQuantity: u.showQuantity,
    locked: done || wo.saving,
    onOrderLinePicked: u.onOrderLine,
  };
  return (
    <>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" testID="ie-tek-form">
        <FieldsButton onPress={fields.openSheet} />
        {!done && (
          <Button mode="contained" icon="file-document-outline" onPress={u.okut} disabled={wo.saving || scan.b.sending || scan.source.busy} contentStyle={styles.bigBtn} labelStyle={styles.bigLabel} testID="ie-belge-okut">
            {row ? 'Belgeyi değiştir' : 'Belge okut'}
          </Button>
        )}
        {!row && (scan.b.pages.length > 0 || scan.b.headerLocked || scan.b.sending) && (
          <ScannerSection b={scan.b} hasRows={false} onAdd={scan.source.add} busy={scan.source.busy} onClassic={scan.openCamera} onRemove={scan.remove} onOpen={scan.setPreviewIndex} />
        )}
        <Text style={styles.section}>Belge</Text>
        {row ? (
          <DocRowCard row={row} wo={wo} customers={u.customers} customersLoading={u.customersLoading} hideGramaj={fields.isOther('gramaj')} />
        ) : (
          <View style={styles.placeholders} testID="ie-form-belge-yer-tutucu">
            {['Müşteri', 'Parti no', 'Kurşun metresi'].map((l) => (
              <SheetField key={l} label={l} value="" placeholder={DOC_PLACEHOLDER} onPress={u.okut} disabled />
            ))}
          </View>
        )}
        <WoFormFields {...fieldProps} show={fields.isTop} />
        <OtherFields count={fields.other.length} open={fields.otherOpen} onToggle={fields.toggleOther}>
          {row?.form && fields.isOther('gramaj') && <GramajField row={row} wo={wo} locked={done || wo.saving} />}
          <WoFormFields {...fieldProps} show={fields.isOther} zone="other" />
        </OtherFields>
        {wo.mode === 'SEPARATE' && (
          <Text style={styles.hint} testID="ie-form-ayri-onay">
            Fabrika ayarı ayrı onay: kayıt taslak kalır; üretim ve plan alanları {TERIM.terbiyeIsEmri.tekilKucuk} panelde onaylanırken girilir.
          </Text>
        )}
      </ScrollView>
      <CreateBar wo={wo} done={done} block={u.block} onNew={props.onNew} />
      <DuplicateDocNoDialog conflict={wo.duplicate?.conflict ?? null} busy={wo.saving} onCancel={wo.dismissDuplicate} onConfirm={() => void wo.confirmDuplicate()} />
      <ScanModals scan={scan} />
      <FieldSelectorSheet
        visible={fields.sheetOpen}
        hidden={fields.prefs.hidden}
        onToggle={fields.prefs.toggle}
        onReset={fields.prefs.reset}
        onDismiss={fields.closeSheet}
        pending={fields.prefs.pending}
      />
    </>
  );
}

/** Formun durumu: rota, ek alanlar, satır (tek belge), tarayıcı; belgeden doldurma ve "oluştur" engeli. */
function useUnifiedWoForm({ initialRoute }: Props) {
  const [route, setRoute] = useState<ProductionRoute | null>(initialRoute);
  const [form, setForm] = useState<WoFormState>(initialFormState);
  const scanMode = useScanRouteMode();
  const showQuantity = useFeatureFlags().data?.targetQuantityEnabled === true;
  const routesQ = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 10 * 60 * 1000,
    enabled: initialRoute === null,
  });
  const hasTambur = useMemo(() => (route?.steps ?? []).some((s) => s.station?.kind === 'TAMBUR'), [route]);
  const fold = useFoldValues();
  // Kat yalnız tamburlu rotada sorulur; ilk katalog değeri ön seçilir (Hızlı İE ile aynı).
  const firstFold = fold.values[0]?.code ?? null;
  useEffect(() => {
    if (hasTambur && firstFold) setForm((s) => (s.extras.foldType ? s : { ...s, extras: { ...s.extras, foldType: firstFold } }));
  }, [hasTambur, firstFold]);

  const extras = form.extras;
  const extraBody = useCallback((r: DocRow) => buildExtraBody(extras, { hasTambur, perParty: r.form?.multi?.mode === 'PER_PARTY' }), [extras, hasTambur]);
  // Rota seçilmeden kayıt `extrasIssues` ile kapalıdır; kanca bir rota ister → yer tutucu.
  const wo = useWoRows(route ?? SCAN_ROUTE, { extraBody });
  const row = wo.rows[0] ?? null;
  const ctx = useQuery({ queryKey: INBOUND_DOC_CONTEXT_KEY, queryFn: inboundDocService.tabletContext, staleTime: 60_000 });
  const customers: PickerOption[] = useMemo(() => (ctx.data?.data.customers ?? []).map((x) => ({ value: x.id, label: x.name })), [ctx.data]);
  const scan = useDocScanFlow(wo.addNote);
  useDocReadToForm(row, setForm);
  const fields = useWoFieldLayout(form, {
    showQuantity: showQuantity || !!extras.targetQuantity || !!extras.targetWeight,
    hasTambur,
    hasKursun: !!wo.showGramaj && wo.catalog.options.length > 0 && !!row?.form,
    hasRouteSteps: !!route && (route.steps?.length ?? 0) > 0,
  });

  const done = row?.result?.kind === 'OPENED' || row?.result?.kind === 'DRAFT';
  const issues = [
    ...extrasIssues(extras, { routeChosen: !!route, hasTambur, perParty: row?.form?.multi?.mode === 'PER_PARTY' }),
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
    route, setRoute, form, fields, scanMode, showQuantity, hasTambur, foldValues: fold.values, wo, row, scan, done, block, okut, customers,
    customersLoading: ctx.isLoading,
    routes: routesQ.data?.data ?? [],
    routesLoading: routesQ.isLoading,
    edit: (patch: Partial<WoFormExtras>) => setForm((s) => editExtras(s, patch)),
    onOrderLine: (l: AvailableOrderLine) => setForm((s) => applyOrderLine(s, { itemId: l.itemId, itemName: l.itemName, colorId: l.colorId, width: l.width })),
  };
}

/** Okuma bitince belgeden gelenler forma dolar (aynı okuma bir kez; elle değiştirilen alan ezilmez); belge çıkınca temizlenir. */
function useDocReadToForm(row: DocRow | null, setForm: React.Dispatch<React.SetStateAction<WoFormState>>) {
  const readKey = row?.detail ? `${row.noteId}#${row.runKey}` : null;
  const detail = row?.detail ?? null;
  useEffect(() => {
    if (readKey && detail) setForm((s) => applyDocRead(s, readKey, detail.formFields, detail.suggestions));
  }, [readKey, detail, setForm]);
  const hasRow = !!row;
  useEffect(() => {
    if (!hasRow) setForm((s) => (s.appliedNoteId ? clearDocRead(s) : s));
  }, [hasRow, setForm]);
}

function CreateBar({ wo, done, block, onNew }: { wo: WoRowsState; done: boolean; block: string | null; onNew: () => void }) {
  return (
    <View style={styles.bar}>
      <Text style={styles.barText} testID="ie-form-ipucu">
        {done ? `${TERIM.terbiyeIsEmri.tekil} kaydedildi.` : block ?? 'Kontrol edin ve oluşturun.'}
      </Text>
      {done ? (
        <Button mode="contained" icon="plus" onPress={onNew} contentStyle={styles.btn} testID="ie-form-yeni">
          {`Yeni ${TERIM.terbiyeIsEmri.tekilKucuk}`}
        </Button>
      ) : (
        <Button
          mode="contained"
          icon="check"
          onPress={() => void wo.saveAll()}
          loading={wo.saving}
          disabled={wo.saving || block !== null || wo.counts.ready === 0}
          contentStyle={styles.btn}
          testID="ie-form-olustur"
        >
          {wo.mode === 'SEPARATE' ? 'Taslak kaydet' : `${TERIM.terbiyeIsEmri.tekil} oluştur`}
        </Button>
      )}
    </View>
  );
}

function ScanModals({ scan }: { scan: ReturnType<typeof useDocScanFlow> }) {
  return (
    <>
      <PagePreviewModal
        pages={scan.b.pages}
        index={scan.previewIndex}
        uploaded={scan.b.progress.uploaded}
        onIndex={scan.setPreviewIndex}
        onRemove={scan.removeFromPreview}
        onDismiss={() => scan.setPreviewIndex(null)}
      />
      <PageCameraModal
        visible={scan.cameraOpen}
        pageNo={scan.b.pages.length + 1}
        onDismiss={scan.closeCamera}
        onCaptured={(p) => {
          scan.closeCamera();
          scan.b.capture(p);
        }}
        onError={(m) => Toast.show({ type: 'error', text1: m })}
      />
    </>
  );
}

/** Tarayıcı akışı (DocBatchView kalıbı): sayfalar gelince yükleme + okuma kendiliğinden; biten belge satır olur. */
function useDocScanFlow(addNote: ReturnType<typeof useWoRows>['addNote']) {
  const b = useDocScan({ successHint: 'Okuma bitince form dolar; kontrol edip oluşturun.' });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const onPages = (ps: ScanPage[]) => {
    const next = b.captureMany(ps);
    if (next) void b.send(next);
  };
  const source = usePageSource(b.pages.length, onPages, () => setCameraOpen(true));
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

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  section: { marginTop: spacing.md, fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  placeholders: { gap: spacing.sm },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  bigBtn: { minHeight: 64 },
  bigLabel: { fontSize: typography.size.lg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  barText: { flex: 1, fontSize: typography.size.sm, color: colors.textSecondary },
  btn: { minHeight: 56 },
});
