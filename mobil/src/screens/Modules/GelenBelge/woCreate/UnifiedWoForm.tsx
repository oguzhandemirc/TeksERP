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
import { DuplicateBatchNoDialog } from '../DuplicateBatchNoDialog';
import PageCameraModal from '../PageCameraModal';
import MultiPageCameraModal from '../MultiPageCameraModal';
import PagePreviewModal from '../PagePreviewModal';
import SameDocumentCard from '../SameDocumentCard';
import { GramajField, type DocRowOpenRequest } from './DocRowCard';
import DocColumn from './DocColumn';
import CreateBar, { type CreateBarSaver } from './CreateBar';
import OwnRollsSection from './OwnRollsSection';
import WoFormFields from './WoFormFields';
import OwnerKindCard from './OwnerKindCard';
import { usePartyScanReview } from './PartyScanSide';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import { FieldSelectorSheet, FieldsButton, OtherFields } from './WoFieldSelector';
import { useCreatedExit, type CreatedExitProps } from './useCreatedExit';
import { useUnifiedWoForm, type DocScanFlow, type UnifiedWoFormProps } from './useUnifiedWoForm';
import { WO_PANE_FLEX, woFormLayout } from './woLayout';
import { bandTone, TARGET_ISSUE_KEYS, TARGET_WARN_KEYS, type IssueKey } from './woIssues';
import type { WoFieldKey } from './woFieldCatalog';
import type { WoCreateKind } from '../../../../store/woCreateKinds';

export default function UnifiedWoForm(props: UnifiedWoFormProps & CreatedExitProps) {
  const u = useUnifiedWoForm(props);
  const { wo, scan, form, done, fields } = u;
  useCreatedExit(done, u.ownMode, wo.mode === 'SEPARATE', props.onCreated);
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
    showWidth: u.showWidth,
    hints: u.hints,
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
  const owner = u.owner.visible ? <OwnerKindCard value={u.owner.value} reason={u.owner.reason} locked={done || wo.saving || u.own.saving} onChange={u.owner.choose} /> : null;
  // Kendi üretim: belge sütunu yerine isteğe bağlı "Toplar"; kayıt quick-start kancasından (alt çubuk aynı).
  const left = u.ownMode ? <OwnRollsSection own={u.own} itemId={u.form.extras.targetItemId} locked={done || u.own.saving} /> : <DocColumn u={u} openRequest={jump.request} />;
  const saver: CreateBarSaver = u.ownMode ? { saving: u.own.saving, saveAll: u.own.save, mode: 'WITH_WORK_ORDER', counts: { ready: 1 } } : wo;
  useKindReport(u.ownMode ? 'STANDARD' : u.owner.value, props.onKindChange);
  return (
    <>
      {twoCol ? (
        // Yan ekranda iki bağımsız kaydırıcı: belge solda sabit kalır, uzun rota/plan sağda kendi içinde kayar.
        <View style={styles.split} testID="ie-form-iki-sutun">
          {/* Oran kutuda: kaydırıcının sarmalayıcısı `flexBasis:auto` taşır, içerik genişliği oranı kaydırırdı. */}
          <View style={[styles.pane, { flex: WO_PANE_FLEX.left }]} testID="ie-form-sol-kutu">
            <KeyboardAwareScrollView ref={jump.leftRef} bottomOffset={24} style={styles.scroll} contentContainerStyle={[styles.body, { padding: layout.pad, paddingBottom: spacing.xl * 2 }]} keyboardShouldPersistTaps="handled" testID="ie-form-sol">
              {owner}
              {left}
            </KeyboardAwareScrollView>
          </View>
          <View style={styles.divider} testID="ie-form-ayrac" />
          <View style={[styles.pane, { flex: WO_PANE_FLEX.right }]} testID="ie-form-sag-kutu">
            <KeyboardAwareScrollView ref={jump.scrollRef} bottomOffset={24} style={styles.scroll} contentContainerStyle={[styles.body, { padding: layout.pad, paddingBottom: spacing.xl * 2 }]} keyboardShouldPersistTaps="handled" testID="ie-form-sag">
              {props.fieldsOpen === undefined && <FieldsButton onPress={fields.openSheet} />}
              <View style={styles.stack} onLayout={jump.at('form')}>
                <FormColumn u={u} fieldProps={fieldProps} onOtherLayout={jump.at('other')} />
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
      ) : (
        <KeyboardAwareScrollView ref={jump.scrollRef} bottomOffset={24} contentContainerStyle={[styles.body, { padding: layout.pad, paddingBottom: spacing.xl * 2 }]} keyboardShouldPersistTaps="handled" testID="ie-tek-form">
          {props.fieldsOpen === undefined && <FieldsButton onPress={fields.openSheet} />}
            {owner}
            <View style={styles.stack} onLayout={jump.at('doc')}>
              {left}
            </View>
            <View style={styles.stack} onLayout={jump.at('form')}>
              <FormColumn u={u} fieldProps={fieldProps} onOtherLayout={jump.at('other')} />
            </View>
        </KeyboardAwareScrollView>
      )}
      <CreateBar wo={saver} done={done} block={u.block} blockKey={u.blockKey} missing={u.missing} onMissing={jump.go} onNew={props.onNew} pad={layout.pad} />
      <DuplicateDocNoDialog conflict={wo.duplicate?.conflict ?? null} busy={wo.saving} onCancel={wo.dismissDuplicate} onConfirm={() => void wo.confirmDuplicate()} />
      <DuplicateBatchNoDialog conflict={wo.duplicateBatch?.conflict ?? null} busy={wo.saving} onCancel={wo.dismissDuplicateBatch} onConfirm={() => void wo.confirmDuplicateBatch()} />
      <ScanModals scan={scan} row={u.row} />
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
        fillTarget={fields.prefs.fillTarget}
        onFillTarget={fields.prefs.setFillTarget}
        otherShown={!fields.prefs.otherHidden}
        onOtherShown={(on) => fields.prefs.setOtherHidden(!on)}
        stepNotesShown={!fields.prefs.stepNotesHidden}
        onStepNotesShown={(on) => fields.prefs.setStepNotesHidden(!on)}
      />
    </>
  );
}

type FormModel = ReturnType<typeof useUnifiedWoForm>;

/** Başlık için etkin mal sahibi türü (İş Emirleri girişi "Fason İş Emri" / "İş Emri" yazar); değişince bildirilir. */
function useKindReport(kind: WoCreateKind | null, onKindChange: ((k: WoCreateKind | null) => void) | undefined) {
  const cb = useRef(onKindChange);
  cb.current = onKindChange;
  useEffect(() => {
    cb.current?.(kind);
  }, [kind]);
}

type Spot = 'doc' | 'form' | 'other';
const METER_KEYS: readonly IssueKey[] = ['kursunMetresi', 'metreDogrula'];

/**
 * Alt çubuk hapı → alan: müşteri seçiciyi, tek parçalı metrede metre sayfasını açar; diğerlerinde ilgili sütuna (kapalı
 * "Diğer alanlar"daysa önce açıp oraya) kaydırır. Konumlar `onLayout`tan; iç içe kutularda üst kutunun y'si eklenir.
 */
function useMissingJump(u: FormModel, twoCol: boolean, external: DocRowOpenRequest | null) {
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  /** Yan ekranda sol (belge) kaydırıcı; tek sütunda kullanılmaz. */
  const leftRef = useRef<KeyboardAwareScrollViewRef>(null);
  const spots = useRef<Partial<Record<Spot, number>>>({});
  const [request, setRequest] = useState<DocRowOpenRequest | null>(null);
  const at = (k: Spot) => (e: LayoutChangeEvent) => {
    spots.current[k] = e.nativeEvent.layout.y;
  };
  const y = (k: Spot) => spots.current[k] ?? 0;
  const formTop = () => y('form');
  const scroll = (to: number) => scrollRef.current?.scrollTo({ y: Math.max(0, to - spacing.md), animated: true });
  // Belge tarafındaki alanlar: yan ekranda sol kaydırıcının başına, tek sütunda belge bloğuna.
  const scrollDoc = () => (twoCol ? leftRef.current?.scrollTo({ y: 0, animated: true }) : scroll(y('doc')));
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
    if (key === 'malSahibi') return twoCol ? scrollDoc() : scroll(0);
    if (METER_KEYS.includes(key)) {
      if (f && !f.multi && !f.rolls) return open('meter');
      return scrollDoc();
    }
    if (key !== 'belge' && u.fields.isOther(key as WoFieldKey)) {
      u.fields.revealOther();
      return scroll(formTop() + y('other'));
    }
    return scroll(formTop());
  };
  return { scrollRef, leftRef, at, go, request };
}

/** Üretim / Plan / Diğer alanlar sütunu. */
interface FormColumnProps {
  u: FormModel;
  fieldProps: Omit<React.ComponentProps<typeof WoFormFields>, 'show' | 'zone'>;
  onOtherLayout: (e: LayoutChangeEvent) => void;
}

function FormColumn({ u, fieldProps, onOtherLayout }: FormColumnProps) {
  const { wo, row, done, fields } = u;
  // Bu formda hiç sorulmayan hedef alanları (Fason kumaş; siparişten gelen / rotanın vermediği renk) iki bölgede de çizilmez.
  const asked = (k: WoFieldKey) => !u.hiddenTarget.includes(k);
  const isTop = (k: WoFieldKey) => asked(k) && fields.isTop(k);
  const isOther = (k: WoFieldKey) => asked(k) && fields.isOther(k);
  return (
    <>
      {u.routeWarning && <NoticeStrip tone="warn" text={u.routeWarning} testID="ie-rota-celiski" />}
      <WoFormFields {...fieldProps} show={isTop} />
      <OtherFields onLayout={onOtherLayout} count={fields.otherShown ? fields.other.length : 0} valued={fields.otherValued} open={fields.otherOpen} onToggle={fields.toggleOther}>
        {row?.form && fields.isOther('gramaj') && !u.partyGramaj && <GramajField row={row} wo={wo} locked={done || wo.saving} />}
        <WoFormFields {...fieldProps} show={isOther} zone="other" />
      </OtherFields>
      {wo.mode === 'SEPARATE' && (
        <Text style={styles.hint} testID="ie-form-ayri-onay">
          Fabrika ayarı ayrı onay: kayıt taslak kalır; üretim ve plan alanları {TERIM.terbiyeIsEmri.tekilKucuk} panelde onaylanırken girilir.
        </Text>
      )}
    </>
  );
}

function ScanModals({ scan, row }: { scan: DocScanFlow; row: FormModel['row'] }) {
  const sent = scan.b.done?.sent ?? [];
  // Çok partili belgede önizleme parti sekmeleriyle açılır; sekme fotoğrafı o partinin satırlarına odaklar.
  const review = usePartyScanReview(row && scan.b.done?.note.id === row.noteId ? row : null, sent, scan.setSentIndex);
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
      <PagePreviewModal
        pages={sent}
        index={scan.sentIndex}
        uploaded={new Set(sent.map((p) => p.sha256))}
        onIndex={scan.setSentIndex}
        onDismiss={() => scan.setSentIndex(null)}
        testID="ie-belge-onizleme"
        side={review?.side}
        focus={review?.focus}
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
  split: { flex: 1, flexDirection: 'row' },
  // flexBasis 0 + minWidth 0: genişlik yalnız orandan; uzun satır sütunu büyütmez, kendi içinde kısalır/sarılır.
  pane: { flexBasis: 0, minWidth: 0 },
  scroll: { flex: 1 },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  stack: { gap: spacing.md },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
});
