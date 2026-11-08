// S16b tablet TEK iş emri formu (`gelenBelge.tabletIeGirisi = BELGE`): her İE karosu bu formu açar (özel İE = rota
// hazır). Solda "Belgeyi okut" → okunan değerler inputlara dolar → görevli kontrol eder → "İş emri oluştur" (form ucu).
// Müşteri / parti / kurşun metresi / gramaj / çok parti bugünkü satır kartından (DocRowCard) gelir; üretim + plan
// inputları WoFormFields'ta (K30-D adımlar/makine/tür/özellik WoPlanFields). Durum `useUnifiedWoForm`; kayıt `useWoRows`
// + satır başına ek gövde alanlarıyla (S16a sözleşmesi).
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
// Klavye düzenlenen alanı örtmesin (prova 2026-11-06): odaktaki girdi klavyenin üstüne kayar; özel numpad (NumpadHost) etkilenmez.
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import { Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { TERIM } from '../../../../lib/terim';
import { colors, spacing, typography } from '../../../../theme';
import { DuplicateDocNoDialog } from '../DuplicateDocNoDialog';
import PageCameraModal from '../PageCameraModal';
import MultiPageCameraModal from '../MultiPageCameraModal';
import PagePreviewModal from '../PagePreviewModal';
import SameDocumentCard from '../SameDocumentCard';
import { GramajField, type DocRowOpenRequest } from './DocRowCard';
import DocColumn from './DocColumn';
import CreateBar from './CreateBar';
import WoFormFields from './WoFormFields';
import OwnerKindCard from './OwnerKindCard';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import { FieldSelectorSheet, FieldsButton, OtherFields } from './WoFieldSelector';
import { useUnifiedWoForm, type DocScanFlow, type UnifiedWoFormProps } from './useUnifiedWoForm';
import { woFormLayout } from './woLayout';
import { bandTone, TARGET_ISSUE_KEYS, TARGET_WARN_KEYS, type IssueKey } from './woIssues';
import type { WoFieldKey } from './woFieldCatalog';

export default function UnifiedWoForm(props: UnifiedWoFormProps) {
  const u = useUnifiedWoForm(props);
  const { wo, scan, form, done, fields } = u;
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
    targetTone: bandTone(u.issues, { keys: TARGET_ISSUE_KEYS, warnKeys: TARGET_WARN_KEYS }),
  };
  const win = useWindowDimensions();
  const layout = woFormLayout(win.width, win.height);
  const twoCol = layout.columns === 2;
  const jump = useMissingJump(u, twoCol, props.openRequest ?? null);
  // Malın sahibi seçimi sol sütunun başında (yan ekranda da), başlıksız.
  const owner = u.owner.visible ? <OwnerKindCard value={u.owner.value} reason={u.owner.reason} locked={done || wo.saving} onChange={u.owner.choose} /> : null;
  return (
    <>
      <KeyboardAwareScrollView ref={jump.scrollRef} bottomOffset={24} contentContainerStyle={[styles.body, { padding: layout.pad, paddingBottom: spacing.xl * 2 }]} keyboardShouldPersistTaps="handled" testID="ie-tek-form">
        {props.fieldsOpen === undefined && <FieldsButton onPress={fields.openSheet} />}
        {twoCol ? (
          <View style={[styles.columns, { gap: layout.pad + spacing.sm }]} onLayout={jump.at('columns')} testID="ie-form-iki-sutun">
            <View style={styles.col} testID="ie-form-sol">
              {owner}
              <DocColumn u={u} openRequest={jump.request} />
            </View>
            <View style={styles.divider} testID="ie-form-ayrac" />
            <View style={styles.col} onLayout={jump.at('form')} testID="ie-form-sag">
              <FormColumn u={u} fieldProps={fieldProps} onOtherLayout={jump.at('other')} />
            </View>
          </View>
        ) : (
          <>
            {owner}
            <View style={styles.stack} onLayout={jump.at('doc')}>
              <DocColumn u={u} openRequest={jump.request} />
            </View>
            <View style={styles.stack} onLayout={jump.at('form')}>
              <FormColumn u={u} fieldProps={fieldProps} onOtherLayout={jump.at('other')} />
            </View>
          </>
        )}
      </KeyboardAwareScrollView>
      <CreateBar wo={wo} done={done} block={u.block} blockKey={u.blockKey} missing={u.missing} onMissing={jump.go} onNew={props.onNew} pad={layout.pad} />
      <DuplicateDocNoDialog conflict={wo.duplicate?.conflict ?? null} busy={wo.saving} onCancel={wo.dismissDuplicate} onConfirm={() => void wo.confirmDuplicate()} />
      <ScanModals scan={scan} />
      <SameDocumentCard
        match={scan.b.sameDoc ?? wo.sameDoc}
        onClose={() => { scan.b.clearSameDoc(); wo.dismissSameDoc(); }}
        onNewWorkOrder={scan.b.sameDoc ? (n) => scan.b.openNote(n) : undefined}
      />
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

type FormModel = ReturnType<typeof useUnifiedWoForm>;

type Spot = 'columns' | 'doc' | 'form' | 'other';
const METER_KEYS: readonly IssueKey[] = ['kursunMetresi', 'metreDogrula'];

/**
 * Alt çubuk hapı → alan: müşteri seçiciyi, tek parçalı metrede metre sayfasını açar; diğerlerinde ilgili sütuna (kapalı
 * "Diğer alanlar"daysa önce açıp oraya) kaydırır. Konumlar `onLayout`tan; iç içe kutularda üst kutunun y'si eklenir.
 */
function useMissingJump(u: FormModel, twoCol: boolean, external: DocRowOpenRequest | null) {
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const spots = useRef<Partial<Record<Spot, number>>>({});
  const [request, setRequest] = useState<DocRowOpenRequest | null>(null);
  const at = (k: Spot) => (e: LayoutChangeEvent) => {
    spots.current[k] = e.nativeEvent.layout.y;
  };
  const y = (k: Spot) => spots.current[k] ?? 0;
  const formTop = () => (twoCol ? y('columns') : 0) + y('form');
  const scroll = (to: number) => scrollRef.current?.scrollTo({ y: Math.max(0, to - spacing.md), animated: true });
  const open = (kind: DocRowOpenRequest['kind']) => setRequest((r) => ({ kind, seq: (r?.seq ?? 0) + 1 }));
  // Dışarıdan istek (okutma önizlemesinin "Müşteri seç"i): aynı kanaldan, sırası artarak.
  const extSeq = external?.seq;
  const extKind = external?.kind;
  useEffect(() => {
    if (extSeq !== undefined && extKind) setRequest((r) => ({ kind: extKind, seq: (r?.seq ?? 0) + 1 }));
  }, [extSeq, extKind]);
  const go = (key: IssueKey) => {
    const f = u.row?.form;
    if (key === 'musteri') return open('owner');
    if (key === 'malSahibi') return scroll(0);
    if (METER_KEYS.includes(key)) {
      if (f && !f.multi && !f.rolls) return open('meter');
      return scroll(twoCol ? y('columns') : y('doc'));
    }
    if (key !== 'belge' && u.fields.isOther(key as WoFieldKey)) {
      if (!u.fields.otherOpen) u.fields.toggleOther();
      return scroll(formTop() + y('other'));
    }
    return scroll(formTop());
  };
  return { scrollRef, at, go, request };
}

/** Üretim / Plan / Diğer alanlar sütunu. */
interface FormColumnProps {
  u: FormModel;
  fieldProps: Omit<React.ComponentProps<typeof WoFormFields>, 'show' | 'zone'>;
  onOtherLayout: (e: LayoutChangeEvent) => void;
}

function FormColumn({ u, fieldProps, onOtherLayout }: FormColumnProps) {
  const { wo, row, done, fields } = u;
  return (
    <>
      {u.routeWarning && <NoticeStrip tone="warn" text={u.routeWarning} testID="ie-rota-celiski" />}
      <WoFormFields {...fieldProps} show={fields.isTop} />
      <OtherFields onLayout={onOtherLayout} count={fields.other.length} valued={fields.otherValued} open={fields.otherOpen} onToggle={fields.toggleOther}>
        {row?.form && fields.isOther('gramaj') && !u.partyGramaj && <GramajField row={row} wo={wo} locked={done || wo.saving} />}
        <WoFormFields {...fieldProps} show={fields.isOther} zone="other" />
      </OtherFields>
      {wo.mode === 'SEPARATE' && (
        <Text style={styles.hint} testID="ie-form-ayri-onay">
          Fabrika ayarı ayrı onay: kayıt taslak kalır; üretim ve plan alanları {TERIM.terbiyeIsEmri.tekilKucuk} panelde onaylanırken girilir.
        </Text>
      )}
    </>
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
  body: { gap: spacing.md },
  columns: { flexDirection: 'row', alignItems: 'stretch' },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  col: { flex: 1, gap: spacing.md },
  stack: { gap: spacing.md },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
});
