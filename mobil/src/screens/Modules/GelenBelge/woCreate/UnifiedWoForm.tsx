// S16b tablet TEK iş emri formu (`gelenBelge.tabletIeGirisi = BELGE`): her İE karosu bu formu açar (özel İE = rota
// hazır). Üstte "Belge okut" → okunan değerler inputlara dolar → görevli kontrol eder → "İş emri oluştur" (form ucu).
// Müşteri / parti / kurşun metresi / gramaj / çok parti bugünkü satır kartından (DocRowCard) gelir; üretim + plan
// inputları WoFormFields'ta (K30-D adımlar/makine/tür/özellik WoPlanFields). Durum `useUnifiedWoForm`; kayıt `useWoRows`
// + satır başına ek gövde alanlarıyla (S16a sözleşmesi).
import React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { SheetField } from '../../../../components/ModuleSheet';
import { TERIM } from '../../../../lib/terim';
import { colors, spacing, typography } from '../../../../theme';
import { DuplicateDocNoDialog } from '../DuplicateDocNoDialog';
import PageCameraModal from '../PageCameraModal';
import MultiPageCameraModal from '../MultiPageCameraModal';
import PagePreviewModal from '../PagePreviewModal';
import { ScannerSection } from './DocBatchView';
import DocRowCard, { GramajField } from './DocRowCard';
import type { WoRowsState } from './useWoRows';
import WoFormFields from './WoFormFields';
import { FieldSelectorSheet, FieldsButton, OtherFields } from './WoFieldSelector';
import { useUnifiedWoForm, type DocScanFlow, type UnifiedWoFormProps } from './useUnifiedWoForm';
import { woFormLayout } from './woLayout';

const DOC_PLACEHOLDER = 'Belge okutulunca dolar';

export default function UnifiedWoForm(props: UnifiedWoFormProps) {
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
    targetDerived: u.targetDerived,
    locked: done || wo.saving,
    onOrderLinePicked: u.onOrderLine,
    plan: u.plan,
  };
  const win = useWindowDimensions();
  const layout = woFormLayout(win.width, win.height);
  const twoCol = layout.columns === 2;
  const docCol = (
    <>
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
    </>
  );
  const formCol = (
    <>
      <WoFormFields {...fieldProps} show={fields.isTop} />
      <OtherFields count={fields.other.length} valued={fields.otherValued} open={fields.otherOpen} onToggle={fields.toggleOther}>
        {row?.form && fields.isOther('gramaj') && <GramajField row={row} wo={wo} locked={done || wo.saving} />}
        <WoFormFields {...fieldProps} show={fields.isOther} zone="other" />
      </OtherFields>
      {wo.mode === 'SEPARATE' && (
        <Text style={styles.hint} testID="ie-form-ayri-onay">
          Fabrika ayarı ayrı onay: kayıt taslak kalır; üretim ve plan alanları {TERIM.terbiyeIsEmri.tekilKucuk} panelde onaylanırken girilir.
        </Text>
      )}
    </>
  );
  return (
    <>
      <ScrollView contentContainerStyle={[styles.body, { padding: layout.pad, paddingBottom: spacing.xl * 2 }]} keyboardShouldPersistTaps="handled" testID="ie-tek-form">
        {props.fieldsOpen === undefined && <FieldsButton onPress={fields.openSheet} />}
        {twoCol ? (
          <View style={[styles.columns, { gap: layout.pad }]} testID="ie-form-iki-sutun">
            <View style={styles.col} testID="ie-form-sol">
              {docCol}
            </View>
            <View style={styles.col} testID="ie-form-sag">
              {formCol}
            </View>
          </View>
        ) : (
          <>
            {docCol}
            {formCol}
          </>
        )}
      </ScrollView>
      <CreateBar wo={wo} done={done} block={u.block} onNew={props.onNew} pad={layout.pad} />
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

function CreateBar({ wo, done, block, onNew, pad }: { wo: WoRowsState; done: boolean; block: string | null; onNew: () => void; pad: number }) {
  return (
    <View style={[styles.bar, { paddingHorizontal: pad }]}>
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

function ScanModals({ scan }: { scan: DocScanFlow }) {
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
      <MultiPageCameraModal {...scan.source.camera} onError={(m) => Toast.show({ type: 'error', text1: m })} />
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

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { flex: 1, gap: spacing.sm },
  section: { marginTop: spacing.md, fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  placeholders: { gap: spacing.sm },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  bigBtn: { minHeight: 64 },
  bigLabel: { fontSize: typography.size.lg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  barText: { flex: 1, fontSize: typography.size.sm, color: colors.textSecondary },
  btn: { minHeight: 56 },
});
