import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon, IconButton, TextInput, Switch } from 'react-native-paper';

import PickerModal from '../../../../components/PickerModal';
import ColorSelectField from '../../../../components/ColorSelectField';
import PropertyPickerModal from './PropertyPickerModal';
import RouteStepsModal from '../RouteStepsModal';
import type { useQuickWorkOrder } from '../useQuickWorkOrder';
import { colors, spacing, radius } from '../../../../theme';

interface Props {
  wo: ReturnType<typeof useQuickWorkOrder>;
  /** İLERİ'ye eksikle basıldı — zorunlu alanların altına kırmızı not düşer. */
  showErrors?: boolean;
}

/**
 * Adım ② — nasıl üretilecek.
 *
 * Hedef renk ve üretim özellikleri yalnız SEÇİLİ ROTA onları uygulayabiliyorsa
 * görünür (`appliesColor` / `appliesProperty` bayraklı bir fason adımı). Eskiden
 * alanlar hep açıktı ve operatör seçtikten sonra "bu rotada renk uygulayacak adım
 * yok" uyarısını yerdi — hataya girilebilen yolu kapatmak uyarı basmaktan iyidir.
 */
export default function StepProduction({ wo, showErrors = false }: Props) {
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [routeStepsOpen, setRouteStepsOpen] = useState(false);
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);

  const widthChanged = !!wo.orderWidth && wo.width.trim() !== wo.orderWidth.trim();
  const selectedPropNames = wo.targetPropertyIds
    .map((id) => wo.propertyNameById[id])
    .filter(Boolean);
  // Eksik alan notu basışa kadar gizli; geçersiz en ise yazıldığı an görünür.
  const issueOf = (field: string) => wo.issues.blocking.find((b) => b.field === field);
  const routeIssue = showErrors ? issueOf('route') : undefined;
  const foldIssue = showErrors ? issueOf('fold') : undefined;
  const widthIssue = issueOf('width');

  return (
    <View style={styles.root}>
      {/* ── Rota ── */}
      <Text style={styles.label}>
        Rota <Text style={styles.req}>*</Text>
      </Text>
      {wo.routeChips.length > 0 ? (
        <View style={styles.chipsWrap}>
          {wo.routeChips.map((c) => {
            const active = wo.routeTemplateId === c.id;
            return (
              <TouchableRipple
                key={c.id}
                onPress={() => wo.chooseRoute(c.id)}
                style={[styles.routeChip, active && styles.routeChipActive]}
                borderless
                rippleColor="rgba(79,70,229,0.12)"
              >
                <Text style={[styles.routeChipText, active && styles.routeChipTextActive]} numberOfLines={1}>
                  {c.isLast ? 'Son · ' : c.isFav ? '★ ' : ''}
                  {c.name}
                </Text>
              </TouchableRipple>
            );
          })}
        </View>
      ) : null}
      <View style={styles.rowGap}>
        <TouchableRipple
          onPress={() => setRoutePickerOpen(true)}
          style={[styles.selectFieldFlex, routeIssue && styles.fieldError]}
          borderless
          rippleColor="rgba(79,70,229,0.12)"
        >
          <Text style={[styles.selectText, !wo.routeLabel && styles.placeholder]} numberOfLines={1}>
            {wo.routeLabel ?? 'Rota seç'}
          </Text>
        </TouchableRipple>
        <IconButton
          icon="information-outline"
          size={24}
          mode="contained-tonal"
          disabled={!wo.selectedRoute}
          onPress={() => setRouteStepsOpen(true)}
          accessibilityLabel="Rota adımlarını gör, istasyon notu / fason firma gir"
          style={styles.infoBtn}
        />
      </View>

      {routeIssue ? <Text style={styles.errorText}>{routeIssue.message}</Text> : null}

      {/* Adım şeridi — ⓘ açmadan ne olacağı görünsün. */}
      {wo.routeStepNames.length > 0 ? (
        <Text style={styles.stepStrip} numberOfLines={2}>
          {wo.routeStepNames.join('  →  ')}
        </Text>
      ) : null}

      {/* Sipariş rengi/özelliği rotanın uygulayamadığı bir şey istiyorsa (hedef
          düşürülemez) rotayı değiştirmesi gerektiğini söyle. */}
      {wo.applyMissing ? (
        <View style={styles.applyWarn}>
          <Icon source="alert" size={15} color={colors.warningDark} />
          <Text style={styles.applyWarnText}>
            Bu rotada {wo.applyMissing} uygulayacak bir fason adımı yok. Uygun adımı içeren bir
            rota seçin.
          </Text>
        </View>
      ) : null}

      {/* ── Kat tipi + En ── */}
      <View style={styles.twoCol}>
        {/* Kat YALNIZ Tambur'lu rotada sorulur (Electron ile aynı sözleşme, 2026-08-10):
            kat Tambur operatörüne yönelik bir spec'tir; tamburu olmayan rotada
            sorulursa hiçbir yerde uygulanmayacak bir değer kaydedilir. */}
        {wo.hasTambur && (
          <View style={styles.col}>
            <Text style={styles.label}>
              Kat Tipi <Text style={styles.req}>*</Text>
            </Text>
            {/* Seçenekler KATALOGDAN — sabit iki çip, panelden eklenen 6-KAT'ı
                tablette görünmez yapardı. Metre cihazı da seçilen kodun ROLÜNDEN
                bulunur (meterPeripheralFor, birebir eşleşme). */}
            <View style={styles.chipsRow}>
              {wo.foldValues.map((f) => {
                const active = wo.foldType === f.code;
                return (
                  <TouchableRipple
                    key={f.code}
                    onPress={() => wo.setFoldType(f.code)}
                    style={[styles.foldChip, active && styles.foldChipActive]}
                    borderless
                    rippleColor="rgba(79,70,229,0.12)"
                  >
                    <Text style={[styles.foldChipText, active && styles.foldChipTextActive]}>
                      {f.name}
                    </Text>
                  </TouchableRipple>
                );
              })}
            </View>
            {foldIssue ? (
              <Text style={styles.errorText}>{foldIssue.message}</Text>
            ) : wo.foldNotConfigured ? (
              <Text style={styles.applyWarnText}>
                Kat değeri tanımlı değil — panelden Kumaş Özellikleri → KAT ekleyin.
              </Text>
            ) : null}
          </View>
        )}
        <View style={styles.col}>
          <Text style={styles.label}>En (cm)</Text>
          <TextInput
            mode="outlined"
            dense
            keyboardType="numeric"
            value={wo.width}
            onChangeText={(t) => wo.setWidth(t.replace(',', '.'))}
            placeholder="örn. 150"
            style={styles.input}
            error={!!widthIssue}
          />
          {widthIssue ? <Text style={styles.errorText}>{widthIssue.message}</Text> : null}
          {/* En sipariş kaleminden ön-dolar ama KİLİTLİ DEĞİL — backend açılışta
              en'i kaleme karşı doğrulamaz (yalnız ürün + renk). Değiştirildiyse
              sessiz kalmayalım. */}
          {wo.orderWidth ? (
            <Text style={[styles.fieldHint, widthChanged && styles.fieldHintWarn]}>
              {widthChanged ? `Siparişten farklı (${wo.orderWidth} cm)` : 'Siparişten geldi'}
            </Text>
          ) : null}
        </View>
      </View>

      {/* ── Hedef renk — yalnız rota renk uyguluyorsa ── */}
      {wo.canApplyColor ? (
        <>
          <Text style={styles.label}>Hedef Renk</Text>
          <ColorSelectField
            value={wo.targetColorId}
            onChange={wo.setTargetColorId}
            // Sipariş bağlıyken renk kilitli: backend farklı renk kabul etmez
            // ("Hedef renk, sipariş satırlarındaki renk ile uyuşmuyor").
            disabled={wo.orderLinked}
            labelOverride={wo.orderLinked ? wo.orderColorName : null}
            onLabelResolved={wo.setColorLabel}
          />
          {wo.orderLinked ? (
            <View style={styles.lockHint}>
              <Icon source="lock" size={13} color={colors.textMuted} />
              <Text style={styles.lockHintText}>Renk sipariş kaleminden gelir, değiştirilemez.</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* ── Üretim özellikleri — yalnız rota özellik uyguluyorsa ── */}
      {wo.canApplyProps ? (
        <>
          <Text style={styles.label}>Üretim Özellikleri</Text>
          <TouchableRipple
            onPress={() => setPropertyPickerOpen(true)}
            style={styles.selectField}
            borderless
            rippleColor="rgba(79,70,229,0.12)"
          >
            <Text
              style={[styles.selectText, selectedPropNames.length === 0 && styles.placeholder]}
              numberOfLines={2}
            >
              {selectedPropNames.length > 0 ? selectedPropNames.join(' · ') : 'Özellik seç (opsiyonel)'}
            </Text>
          </TouchableRipple>
          {wo.orderLinked && wo.targetPropertyIds.length === 0 ? (
            <Text style={styles.fieldHint}>
              Boş bırakılırsa sipariş kaleminin istediği özellikler uygulanır.
            </Text>
          ) : null}
        </>
      ) : null}

      {/* ── Fasona Gönder — yalnız ilk rota adımı fason (boyahane) ise ── */}
      {wo.firstStepDispatch.isFason ? (
        <View style={styles.dispatchToggle}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dispatchToggleTitle}>Fasona Gönder</Text>
            <Text style={styles.dispatchToggleHint}>
              {wo.firstStepDispatch.firmId
                ? 'İş emri açılınca mal fasona sevk edilir, çeki listesi oluşur. Kapatırsan yalnız planlanır.'
                : 'Fason firma seçili değil — sevk yapılamaz, yalnız planlanır.'}
            </Text>
          </View>
          <Switch
            value={wo.dispatchFirstStep && !!wo.firstStepDispatch.firmId}
            onValueChange={wo.setDispatchFirstStep}
            disabled={!wo.firstStepDispatch.firmId}
          />
        </View>
      ) : null}

      <PickerModal
        visible={routePickerOpen}
        title="Rota Şablonu Seç"
        options={wo.routeOptions}
        selectedValue={wo.routeTemplateId}
        loading={wo.routesQuery.isLoading}
        onSelect={wo.chooseRoute}
        onDismiss={() => setRoutePickerOpen(false)}
        onRefresh={() => wo.routesQuery.refetch()}
        emptyText="Rota şablonu yok"
      />

      <PropertyPickerModal
        visible={propertyPickerOpen}
        onDismiss={() => setPropertyPickerOpen(false)}
        options={wo.propertiesQuery.data?.data ?? []}
        loading={wo.propertiesQuery.isLoading}
        value={wo.targetPropertyIds}
        onChange={wo.setTargetPropertyIds}
      />

      <RouteStepsModal
        visible={routeStepsOpen}
        onDismiss={() => setRouteStepsOpen(false)}
        route={wo.selectedRoute}
        editable
        notes={wo.stepNotes}
        onChangeNote={(seq, text) => wo.setStepNotes((prev) => ({ ...prev, [seq]: text }))}
        selectedFirmBySeq={wo.selectedFirmBySeq}
        firmOptionsByCategory={wo.firmOptionsByCategory}
        firmNameById={wo.firmNameById}
        onChangeSubcontractor={(seq, firmId) =>
          wo.setStepSubcontractors((prev) => ({ ...prev, [seq]: firmId }))
        }
        noColorBySeq={wo.noColorBySeq}
        onToggleNoColor={(seq, next) =>
          wo.setStepNoColor((prev) => ({ ...prev, [seq]: next }))
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: spacing.md, gap: spacing.xs },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 2 },
  req: { color: colors.danger },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectField: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  selectFieldFlex: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    backgroundColor: colors.surface,
  },
  selectText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  input: { backgroundColor: colors.surface },
  infoBtn: { margin: 0, backgroundColor: colors.brandSoft },

  stepStrip: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },

  fieldHint: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 3 },
  fieldError: { borderColor: colors.danger, borderWidth: 2 },
  errorText: { fontSize: 12, color: colors.dangerDark, fontWeight: '700', marginTop: 3 },
  fieldHintWarn: { color: colors.warningDark },
  lockHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  lockHintText: { fontSize: 11, color: colors.textMuted, fontWeight: '600', flex: 1 },

  applyWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  applyWarnText: { flex: 1, color: colors.warningDark, fontSize: 12, fontWeight: '600', lineHeight: 16 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2, marginBottom: 2 },
  routeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    maxWidth: 200,
  },
  routeChipActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft, borderWidth: 2 },
  routeChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  routeChipTextActive: { color: colors.brand },

  twoCol: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  chipsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  foldChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  foldChipActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft, borderWidth: 2 },
  foldChipText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  foldChipTextActive: { color: colors.brand },

  dispatchToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dispatchToggleTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  dispatchToggleHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
