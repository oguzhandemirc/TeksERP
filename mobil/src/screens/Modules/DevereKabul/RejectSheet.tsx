// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — kusurlu levent reddi sayfası (ek-2 r, TEK KART `ModuleSheet` xl)
// =============================================================================
// Tablet tasarım dili: SOL = şu anki iş (levent kimliği büyük, sipariş/devereci gri satır, kahraman metre,
// sebep, kip, not) · SAĞ = kanıt + sonuç (fotoğraflar, sunucu önizlemesi: dönen iplik + engeller) · ALT BANT =
// Vazgeç + turuncu "DEVERECİYE GERİ GÖNDER". Ayrı onay penceresi yok: sayfa kendisi onaydır (ret panelden iptal edilebilir).
// =============================================================================
import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import ModalTextInput from '../../../components/ModalTextInput';
import TruncatedText from '../../../components/TruncatedText';
import StationActionButton from '../../../components/StationActionButton';
import ReasonPresetPicker from '../../../components/reasonPresets/ReasonPresetPicker';
import { ChoiceRow } from '../../../components/form';
import { useReasonPresets } from '../../../hooks/useReasonPresets';
import { colors, moduleAccents, palette, radius, spacing, typography } from '../../../theme';
import { fmtMeters } from '../../../utils/meters';
import { REJECT_MAX_PHOTOS } from '../../../services/devereKabul.service';
import { photoAddBlock, rejectBlockText, REJECT_NOTES_MAX, type RejectDraft } from './rejectPayload';
import type { BeamRejectState } from './useBeamReject';
import RejectCameraModal from './RejectCameraModal';

interface Props {
  state: BeamRejectState;
  draft: RejectDraft;
  isOnline: boolean;
  /** Bağlamdaki ayar (eski sunucu → undefined); önizleme gelince onun değeri esas. */
  photoRequiredHint?: boolean;
}

const kg = (v: string) => `${Number(v).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} kg`;

export default function RejectSheet({ state, draft, isOnline, photoRequiredHint }: Props) {
  const { presets } = useReasonPresets('WARP_BEAM_REJECT');
  const [camera, setCamera] = useState(false);
  const pv = state.rejectPreview.data;
  const photoRequired = pv?.photoRequired ?? photoRequiredHint ?? false;
  const block = rejectBlockText(draft, presets, photoRequired);
  const set = (p: Partial<RejectDraft>) => state.setRejectDraft((cur) => (cur ? { ...cur, ...p } : cur));
  const { beam, order } = draft.target;
  const pending = state.rejectSubmit.isPending;
  const canSend = isOnline && !block && !!pv?.rejectable && !state.rejectPreview.isFetching && !pending;
  const footerNote = !isOnline ? 'Ağ yok — ret yapılamaz (kuyruk yok)' : block ?? pv?.blockers[0]?.message ?? null;

  return (
    <ModuleSheet
      visible
      size="xl"
      onDismiss={pending ? () => undefined : state.closeReject}
      title="Kusurlu levent — devereciye geri gönder"
      subtitle="Levent kabulden düşer, ipliği deverecinin hesabına geri yazılır"
      overlays={
        <RejectCameraModal
          visible={camera}
          onDismiss={() => setCamera(false)}
          onError={(m) => Toast.show({ type: 'error', text1: 'Fotoğraf çekilemedi', text2: m })}
          onCaptured={(ph) => {
            setCamera(false);
            const err = photoAddBlock(draft, ph.base64);
            if (err) Toast.show({ type: 'error', text1: err });
            else set({ photos: [...draft.photos, ph] });
          }}
        />
      }
      footer={
        <>
          {footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}
          <Button mode="outlined" onPress={state.closeReject} disabled={pending} contentStyle={styles.tall}>Vazgeç</Button>
          <View style={styles.send}>
            <StationActionButton label="DEVERECİYE GERİ GÖNDER" icon="truck-fast-outline" onPress={() => state.rejectSubmit.mutate()} tint={palette.orange[600]} loading={pending} loadingLabel="Gönderiliyor…" disabled={!canSend} large testID="devere-ret-gonder" />
          </View>
        </>
      }
    >
      <View style={sheet.row}>
        <View style={[sheet.col, styles.colGap]}>
          <View style={styles.idRow}>
            <View style={styles.idText}>
              <Text style={styles.beamNo} testID="devere-ret-levent">{beam.beamNo}</Text>
              <TruncatedText style={styles.subLine}>{[order.orderNo, order.subcontractor.name, beam.bodyNo ? `gövde ${beam.bodyNo}` : beam.physicalBeamNo].filter(Boolean).join(' · ')}</TruncatedText>
            </View>
            <View style={styles.hero} testID="devere-ret-metre">
              <Text style={styles.heroValue}>{beam.lengthM ? fmtMeters(Number(beam.lengthM)) : '—'}</Text>
              <Text style={styles.heroSub}>m levent</Text>
            </View>
          </View>
          <Text style={sheet.label}>Neden geri gönderiliyor?</Text>
          <ReasonPresetPicker kind="WARP_BEAM_REJECT" value={draft.reason} onChange={(reason) => set({ reason })} placeholder="Kusuru kısaca yazın" maxLength={300} />
          <ChoiceRow
            label="Ne olsun?"
            rowTestID="devere-ret-kip"
            testID="devere-ret-kip-secim"
            value={draft.expectRework ? 'REWORK' : 'CANCEL'}
            onChange={(v) => set({ expectRework: v !== 'CANCEL' })}
            options={[
              { value: 'REWORK', label: 'Yeniden sarılsın', icon: 'restore', testID: 'devere-ret-kip-rework' },
              { value: 'CANCEL', label: 'İptal — iplik deverecide kalsın', icon: 'close-circle-outline', testID: 'devere-ret-kip-iptal' },
            ]}
          />
          <Text style={sheet.label}>Not (isteğe bağlı)</Text>
          <ModalTextInput mode="outlined" value={draft.notes} onChangeText={(notes) => set({ notes })} maxLength={REJECT_NOTES_MAX} placeholder="Ör. sağ kenarda 3 m kopuk" style={sheet.input} />
        </View>
        <View style={[sheet.col, styles.colGap]}>
          <PhotoCard draft={draft} required={photoRequired} disabled={pending} onCamera={() => setCamera(true)} onRemove={(i) => set({ photos: draft.photos.filter((_, j) => j !== i) })} />
          <PreviewCard query={state.rejectPreview} />
        </View>
      </View>
    </ModuleSheet>
  );
}

function PhotoCard({ draft, required, disabled, onCamera, onRemove }: { draft: RejectDraft; required: boolean; disabled: boolean; onCamera: () => void; onRemove: (i: number) => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{`Fotoğraf ${required ? '(zorunlu)' : '(isteğe bağlı)'} · ${draft.photos.length}/${REJECT_MAX_PHOTOS}`}</Text>
      <View style={styles.photos}>
        {draft.photos.map((ph, i) => (
          <View key={ph.uri} style={styles.thumbWrap}>
            <Image source={{ uri: ph.uri }} style={styles.thumb} />
            <IconButton icon="close" size={20} mode="contained" containerColor={colors.surface} style={styles.thumbX} onPress={() => onRemove(i)} accessibilityLabel={`Fotoğraf ${i + 1} sil`} />
          </View>
        ))}
        {draft.photos.length < REJECT_MAX_PHOTOS ? (
          <Button mode="outlined" icon="camera" onPress={onCamera} contentStyle={styles.photoBtn} disabled={disabled} testID="devere-ret-foto">Fotoğraf çek</Button>
        ) : null}
      </View>
    </View>
  );
}

/** Sunucu önizlemesi: deverecinin tutmasına dönecek iplik + engeller (istemci sayı türetmez). */
function PreviewCard({ query }: { query: BeamRejectState['rejectPreview'] }) {
  const pv = query.data;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Deverecinin hesabına dönecek iplik</Text>
      {query.isLoading ? <Text style={sheet.hint}>Hesaplanıyor…</Text> : null}
      {query.isError ? <Text style={sheet.error}>Önizleme alınamadı — ağ ya da yetki.</Text> : null}
      {pv?.returnedYarn.map((y) => (
        <View key={`${y.yarnItemId}|${y.dispatchNo}|${y.holderOrderNo}`} style={sheet.summaryRow}>
          <TruncatedText style={sheet.summaryLabel}>{[y.name || y.code, y.lotNo ? `parti ${y.lotNo}` : null].filter(Boolean).join(' · ')}</TruncatedText>
          <Text style={sheet.summaryValue}>{kg(y.kg)}</Text>
        </View>
      ))}
      {pv && pv.returnedYarn.length > 0 ? <Text style={styles.total}>{`Toplam ${kg(pv.totals.returnedKg)}`}</Text> : null}
      {pv?.warnings.map((w) => <Text key={w} style={sheet.warn}>{w}</Text>)}
      {pv?.blockers.filter((b) => b.code !== 'WARPING_REJECT_PHOTO_REQUIRED').map((b) => <Text key={b.code + b.message} style={sheet.error}>{b.message}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  colGap: { gap: spacing.sm },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  idText: { flex: 1, gap: 2 },
  beamNo: { fontSize: typography.size.display, fontWeight: typography.weight.bold, color: colors.text },
  subLine: { fontSize: typography.size.sm, color: colors.textSecondary },
  hero: { backgroundColor: moduleAccents.DevereKabul.tint, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center', minWidth: 140 },
  heroValue: { fontSize: typography.size.display, fontWeight: '900', color: palette.white },
  heroSub: { fontSize: typography.size.xs, fontWeight: '700', color: palette.white },
  card: { borderRadius: radius.md, backgroundColor: colors.surfaceMuted, padding: spacing.md, gap: spacing.xs },
  cardTitle: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  thumbWrap: { position: 'relative' },
  thumb: { width: 112, height: 84, borderRadius: radius.md, backgroundColor: colors.border },
  thumbX: { position: 'absolute', top: -10, right: -10, margin: 0 },
  photoBtn: { height: 84, paddingHorizontal: spacing.md },
  total: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text, textAlign: 'right', marginTop: spacing.xs },
  footerNote: { flex: 1, color: colors.dangerText, fontSize: typography.size.sm },
  send: { minWidth: 360 },
  tall: { height: 56 },
});
