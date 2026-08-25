import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon, Surface } from 'react-native-paper';

import type { useQuickWorkOrder } from '../useQuickWorkOrder';
import { colors, spacing, radius } from '../../../../theme';
import ReasonPresetPicker from '../../../../components/reasonPresets/ReasonPresetPicker';

interface Props {
  wo: ReturnType<typeof useQuickWorkOrder>;
  /** Bir özet satırından ilgili adıma dön. */
  onGoTo: (stepIndex: number) => void;
}

interface RowProps {
  label: string;
  value: string;
  onPress?: () => void;
  muted?: boolean;
}

function Row({ label, value, onPress, muted }: RowProps) {
  const body = (
    <View style={styles.rowInner}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, muted && styles.rowValueMuted]} numberOfLines={2}>
        {value}
      </Text>
      {onPress ? <Icon source="chevron-right" size={20} color={colors.textMuted} /> : null}
    </View>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <TouchableRipple onPress={onPress} style={styles.row} borderless rippleColor="rgba(79,70,229,0.10)">
      {body}
    </TouchableRipple>
  );
}

/** Adım ③ — başlatmadan önce her şeyi tek ekranda göster; her satır düzeltmeye götürür. */
export default function StepConfirm({ wo, onGoTo }: Props) {
  const propNames = wo.targetPropertyIds.map((id) => wo.propertyNameById[id]).filter(Boolean);
  const firmName = wo.firstStepDispatch.firmId
    ? (wo.firmNameById[wo.firstStepDispatch.firmId] ?? 'firma')
    : null;
  const willDispatch =
    wo.dispatchFirstStep && wo.firstStepDispatch.isFason && !!wo.firstStepDispatch.firmId;

  return (
    <View style={styles.root}>
      <Surface style={styles.card} elevation={1}>
        <Row
          label="Toplar"
          value={
            wo.reworkRolls.length > 0
              ? `${wo.scanned.length} top · ${Math.round(wo.totalQty)} m  (${wo.reworkRolls.length}'i bitmiş depodan)`
              : `${wo.scanned.length} top · ${Math.round(wo.totalQty)} m`
          }
          onPress={() => onGoTo(0)}
        />
        <Row
          label="Kumaş"
          value={wo.lockedItemName ?? '—'}
          muted={!wo.lockedItemName}
        />
        <Row label="Rota" value={wo.routeLabel ?? 'Seçilmedi'} onPress={() => onGoTo(1)} />
        {wo.routeStepNames.length > 0 ? (
          <View style={styles.stepStripRow}>
            <Text style={styles.stepStrip} numberOfLines={3}>
              {wo.routeStepNames.join('  →  ')}
            </Text>
          </View>
        ) : null}
        <Row
          label="Kat / En"
          value={[wo.foldType ?? '—', wo.width.trim() ? `${wo.width.trim()} cm` : null]
            .filter(Boolean)
            .join(' · ')}
          onPress={() => onGoTo(1)}
        />
        {wo.canApplyColor ? (
          <Row
            label="Hedef renk"
            value={wo.orderColorName ?? wo.colorLabel ?? 'Renksiz / Ham'}
            muted={!wo.orderColorName && !wo.colorLabel}
            onPress={() => onGoTo(1)}
          />
        ) : null}
        {wo.canApplyProps ? (
          <Row
            label="Özellikler"
            value={
              propNames.length > 0
                ? propNames.join(' · ')
                : wo.orderLinked
                  ? 'Siparişten uygulanacak'
                  : 'Yok'
            }
            muted={propNames.length === 0}
            onPress={() => onGoTo(1)}
          />
        ) : null}
        <Row
          label="Sipariş"
          value={wo.orderLinked ? `${wo.orderLineIds.length} kalem bağlı` : 'Stok üretimi'}
          muted={!wo.orderLinked}
          onPress={() => onGoTo(0)}
        />
        {wo.firstStepDispatch.isFason ? (
          <Row
            label="Fasona gönder"
            value={willDispatch ? `Evet · ${firmName}` : 'Hayır, yalnız planlanır'}
            muted={!willDispatch}
            onPress={() => onGoTo(1)}
          />
        ) : null}
      </Surface>

      {/* ── ÖLÜ ETİKET (2026-08-25) ────────────────────────────────────────
          Burada geçersizleşme OLASILIK DEĞİL KESİN: fason kabulünde orijinal top
          `SUBCONTRACTOR_CONSUMED` olur ve mal YENİ barkodla döner ("top fasona
          gittiyse mutlaka açıldı — kimliğini kaybeder"). Aynı gün KALDIRILAN
          genel iptal onayından farkı budur; yine de ENGEL DEĞİL, bilgi. */}
      {wo.labelAtRisk.length > 0 ? (
        <View style={styles.labelWarn}>
          <View style={styles.labelWarnHead}>
            <Icon source="tag-off-outline" size={18} color={colors.warningDark} />
            <Text style={styles.labelWarnTitle}>
              {`${wo.labelAtRisk.length} topun etiketi geçersizleşecek`}
            </Text>
          </View>
          <Text style={styles.labelWarnBody}>
            Fasona giden top orada açılıp birleştirilir — kabulde bu kayıtlar kapanır ve mal
            YENİ barkodla döner. Eski etiketleri toptan sökün.
          </Text>
          <Text style={styles.labelWarnCodes}>
            {wo.labelAtRisk.map((r) => r.barcode).join(' · ')}
          </Text>
        </View>
      ) : null}

      {/* Sebep — yalnız bitmiş top varsa ve İSTEĞE BAĞLI (kullanıcı kararı). */}
      {wo.reworkRolls.length > 0 ? (
        <Surface style={styles.reworkCard} elevation={0}>
          <View style={styles.reworkHead}>
            <Icon source="recycle" size={18} color={colors.text} />
            <Text style={styles.reworkTitle}>Neden yeniden üretime alınıyor?</Text>
          </View>
          <Text style={styles.reworkHint}>
            İsteğe bağlı. Yazarsan boyahane çeki listesine talimat olarak basılır.
          </Text>
          <ReasonPresetPicker
            kind="WORK_ORDER_REWORK"
            value={wo.reworkReason}
            onChange={wo.setReworkReason}
            optional
            placeholder="Kendin yaz — ya da aşağıdan seç"
          />
        </Surface>
      ) : null}

      {willDispatch ? (
        <View style={styles.dispatchNote}>
          <Icon source="truck-fast-outline" size={18} color={colors.brand} />
          <Text style={styles.dispatchNoteText}>
            Başlat'a basınca mal aynı anda {firmName} firmasına sevk edilir ve çeki listesi
            oluşur.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: spacing.md, gap: spacing.md },
  labelWarn: {
    backgroundColor: colors.warningContainer,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  labelWarnHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  labelWarnTitle: { fontSize: 14, fontWeight: '800', color: colors.warningDark, flexShrink: 1 },
  labelWarnBody: { fontSize: 12, color: colors.warningDark, lineHeight: 17 },
  labelWarnCodes: { fontFamily: 'monospace', fontSize: 11, color: colors.warningDark },
  reworkCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  reworkHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reworkTitle: { fontSize: 15, fontWeight: '800', color: colors.text, flexShrink: 1 },
  reworkHint: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  row: { borderRadius: radius.sm },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, width: 108 },
  rowValue: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text, textAlign: 'right' },
  rowValueMuted: { color: colors.textMuted, fontWeight: '600' },
  stepStripRow: { paddingBottom: 12, paddingTop: 2 },
  stepStrip: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textAlign: 'right', lineHeight: 17 },
  dispatchNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  dispatchNoteText: { flex: 1, color: colors.brand, fontSize: 12, fontWeight: '700', lineHeight: 17 },
});
