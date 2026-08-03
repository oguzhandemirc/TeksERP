// =============================================================================
// TAMBUR SAHA DÜZELTMESİ — "Manuel Top Ekle"
// =============================================================================
// Sistemde HİÇ olmayan bir topu elle yaratır ve doğrudan bu Tambur adımına bağlar
// (operatör hemen kesebilsin).
//
// BU EKRAN ENVANTER ZİNCİRİNDEKİ TEK DELİĞİ AÇAR. Diğer her top ya KK1 girişine,
// ya bir fason kabul makbuzuna, ya da mevcut bir topun kesilmesine dayanır. Bu
// yüzden UI da deliği SAKLAMAZ:
//   • METRAJ ve SEBEP zorunludur (sebep kalıcı olarak audit'e yazılır),
//   • onay adımı ne yaratılacağını SOMUT yazar (yıkıcı-onay ilkesi: "1 kayıt
//     etkilenecek" gibi soyut cümle yetmez),
//   • topun "elle eklendi" işareti (MANUEL_ENTRY) operatöre açıkça söylenir.
//
// İDEMPOTENCY: `clientToken` MANTIKSAL DENEME başına BİR kez üretilir. Onay
// ekranına girişte doğar, forma geri dönülünce (payload değişebilir) DÜŞER,
// başarıda temizlenir. Aynı payload'la tekrar denemede AYNI token gider →
// timeout/retry mükerrer top doğurmaz. Her mutate çağrısında yeni token üretmek
// korumayı boşa düşürürdü (kök CLAUDE.md).
//
// NEDEN AYRI DOSYA: `TamburScreen.tsx` ~6000 satır — yeni modal kodu oraya
// yazılmaz (emsal: `CutActionBar.tsx`).
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  Button,
  Icon,
  IconButton,
  Surface,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { isWorkSessionLost } from '../../../services/api';
import { itemService } from '../../../services/item.service';
import { colorService } from '../../../services/color.service';
import {
  tamburService,
  type TamburManualRollRequest,
} from '../../../services/tambur.service';
import { generateClientUuid } from '../../../offline/barcode';
import { colors, radius, spacing } from '../../../theme';
import type { QualityGrade } from '../../../types/models';

/** Sebep alanı — backend de aynı alt sınırı uygular (min 3 karakter). */
const MIN_REASON = 3;

/**
 * Renk ÜÇ DEĞERLİDİR ve üçü de ayrı anlam taşır:
 *   inherit → alan gönderilmez, iş emrinin hedef rengi miras alınır
 *   none    → `colorId: null` — AÇIKÇA renksiz ("boyasız geldi" susturulmasın)
 *   pick    → operatörün seçtiği renk
 */
type ColorMode = 'inherit' | 'none' | 'pick';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Ekrandaki Tambur adımı (WorkOrderStep) — topun bağlanacağı adım. */
  targetStepId: string;
  stationName: string;
  /** Kalite kataloğu — ekran zaten yüklüyor, tekrar sorgulanmaz. */
  qualityGrades: QualityGrade[];
  /** Çevrimiçi mi — bu uç online-only (offline kuyruğuna GİRMEZ). */
  online: boolean;
  /** Başarıdan sonra çağrılır — ekran Tambur listesini tazeler. */
  onCreated: () => void;
}

export default function TamburManualRollModal({
  visible,
  onDismiss,
  targetStepId,
  stationName,
  qualityGrades,
  online,
  onCreated,
}: Props) {
  const { height } = useWindowDimensions();
  const [phase, setPhase] = useState<'form' | 'confirm'>('form');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const [itemLabel, setItemLabel] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('inherit');
  const [colorId, setColorId] = useState<string | null>(null);
  const [colorLabel, setColorLabel] = useState<string | null>(null);
  const [width, setWidth] = useState('');
  const [qualityCode, setQualityCode] = useState<string | null>(null);
  const [picker, setPicker] = useState<'item' | 'color' | null>(null);
  // Kataloglar YALNIZ operatör picker'ı açınca çekilir: ürün/renk listeleri ayrı
  // yetki ister (`item:read` / `property:read`) ve saf Tambur operatöründe
  // olmayabilir. Boşuna 403 üretme; istenirse iste, olmazsa net söyle.
  const [itemCatalogWanted, setItemCatalogWanted] = useState(false);
  const [colorCatalogWanted, setColorCatalogWanted] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const reset = () => {
    setPhase('form');
    setQty('');
    setReason('');
    setOptionalOpen(false);
    setItemId(null);
    setItemLabel(null);
    setColorMode('inherit');
    setColorId(null);
    setColorLabel(null);
    setWidth('');
    setQualityCode(null);
    setPicker(null);
    tokenRef.current = null;
  };

  // Kapanışta sıfırla — bir sonraki açılış önceki topun metrajıyla başlamasın.
  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  const itemsQuery = useQuery({
    queryKey: ['items', 'tambur-manual', 'FABRIC'],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: 'code',
        sortOrder: 'asc',
        filters: { isActive: 'true', itemType: 'FABRIC' },
      }),
    enabled: itemCatalogWanted,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const colorsQuery = useQuery({
    queryKey: ['colors', 'tambur-manual-public'],
    queryFn: () =>
      colorService.listPublicForPicker({
        page: 1,
        pageSize: 300,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
    enabled: colorCatalogWanted,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const itemOptions = useMemo<PickerOption[]>(
    () =>
      (itemsQuery.data?.data ?? []).map((i) => ({
        value: i.id,
        label: i.name,
        sublabel: i.code,
      })),
    [itemsQuery.data],
  );

  const colorOptions = useMemo<PickerOption[]>(
    () =>
      (colorsQuery.data?.data ?? []).map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.code ?? undefined,
        badge: c.hex ? { text: ' ', color: c.hex } : undefined,
      })),
    [colorsQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: (payload: TamburManualRollRequest) => tamburService.createManualRoll(payload),
    onSuccess: (res) => {
      tokenRef.current = null;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: res.data.alreadyAttached ? 'Top zaten eklenmişti' : 'Top elle eklendi',
        text2: res.message ?? `Barkod: ${res.data.barcode ?? '—'}`,
        visibilityTime: 6000,
      });
      onCreated();
      onDismiss();
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor zaten bildirdi
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Top eklenemedi', text2: err.message });
    },
  });

  const qtyNum = Number(qty);
  const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0;
  const widthNum = width.trim() ? Number(width) : null;
  const widthValid = widthNum === null || (Number.isFinite(widthNum) && widthNum > 0);
  const reasonValid = reason.trim().length >= MIN_REASON;
  // Renkte "yarım seçim" durumu YOK: `pick` moduna yalnız picker'da bir renk
  // seçilince geçilir (vazgeçilirse önceki mod korunur) → ek doğrulama gereksiz.
  const formValid = qtyValid && widthValid && reasonValid;

  const goConfirm = () => {
    if (!formValid) return;
    // Mantıksal deneme BURADA başlar → token burada doğar.
    if (!tokenRef.current) tokenRef.current = generateClientUuid();
    setPhase('confirm');
  };

  const backToForm = () => {
    // Payload değişebilir → aynı token'la farklı içerik göndermek backend'de
    // idempotency ÇAKIŞMASI (409) üretir; token'ı burada düşür.
    tokenRef.current = null;
    setPhase('form');
  };

  const submit = () => {
    if (!formValid || !tokenRef.current) return;
    const payload: TamburManualRollRequest = {
      targetStepId,
      initialQty: qtyNum,
      reason: reason.trim(),
      clientToken: tokenRef.current,
    };
    if (itemId) payload.itemId = itemId;
    if (colorMode === 'none') payload.colorId = null;
    else if (colorMode === 'pick' && colorId) payload.colorId = colorId;
    if (widthNum !== null) payload.width = widthNum;
    if (qualityCode) payload.qualityGrade = qualityCode;
    createMutation.mutate(payload);
  };

  const busy = createMutation.isPending;
  const colorSummary =
    colorMode === 'none'
      ? 'Renksiz (operatör seçti)'
      : colorMode === 'pick'
        ? `${colorLabel ?? 'Seçilen renk'} (operatör seçti)`
        : 'İş emrinin hedef rengi';
  const qualityName = qualityCode
    ? (qualityGrades.find((q) => q.code === qualityCode)?.name ?? qualityCode)
    : 'Belirsiz (kalite girilmedi)';

  return (
    <>
      <AppModal
        visible={visible && picker === null}
        onDismiss={onDismiss}
        // İşlem uçuştayken perde/geri tuşu kapatmaz (AppModal dismissable=false
        // iken backdrop'u da devre dışı bırakır) — top yaratılırken modal
        // kapanıp operatör "olmadı" sanmasın.
        dismissable={!busy}
        swipeToDismiss={!busy}
      >
        <Surface style={[styles.sheet, { maxHeight: height * 0.85 }]} elevation={4}>
          <View style={styles.header}>
            <Icon source="plus-box-outline" size={24} color={colors.action} />
            <View style={styles.headerText}>
              <Text style={styles.title}>Manuel Top Ekle</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                Hedef: {stationName}
              </Text>
            </View>
            <IconButton
              icon="close"
              size={20}
              disabled={busy}
              onPress={onDismiss}
              accessibilityLabel="Kapat"
            />
          </View>

          {!online && (
            <View style={styles.offlineBand}>
              <Icon source="wifi-off" size={16} color={colors.warningText} />
              <Text style={styles.offlineText}>
                Çevrimdışı — manuel top kuyruğa alınmaz (barkodu sunucu üretir), bağlantı
                gelince tekrar deneyin.
              </Text>
            </View>
          )}

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollBody}>
            {phase === 'form' ? (
              <>
                <View style={styles.noticeBox}>
                  <Icon source="information-outline" size={16} color={colors.infoText} />
                  <Text style={styles.noticeText}>
                    Bu top hiçbir ham giriş / fason makbuzu / kesim kaydına dayanmayacak.
                    Kalıcı olarak "elle eklendi" işaretlenir ve yazdığın sebep kaydedilir.
                  </Text>
                </View>

                {/* ── Zorunlu: metraj ── */}
                <View>
                  <Text style={styles.label}>
                    Metraj (m) <Text style={styles.req}>*</Text>
                  </Text>
                  <NumpadInput
                    mode="outlined"
                    dense
                    // Modal içinde NumpadHost YOK → büyük özel numpad görünmez
                    // kalırdı; sistem decimal-pad'i (virgül→nokta normalizasyonuyla).
                    useNativeKeyboard
                    value={qty}
                    onChangeText={setQty}
                    placeholder="örn. 120"
                    disabled={busy}
                    style={styles.input}
                  />
                </View>

                {/* ── Zorunlu: sebep ── */}
                <View>
                  <Text style={styles.label}>
                    İşlem nedeni <Text style={styles.req}>*</Text>
                  </Text>
                  <TextInput
                    mode="outlined"
                    multiline
                    numberOfLines={2}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Örn: Sistemde kaydı yok, ham giriş atlanmış"
                    maxLength={500}
                    disabled={busy}
                    style={styles.input}
                  />
                  <Text style={styles.hintSmall}>
                    En az {MIN_REASON} karakter — sayım tutmadığında "bu top nereden geldi"
                    sorusunun cevabı bu.
                  </Text>
                </View>

                {/* ── Opsiyonel alanlar ── */}
                <TouchableRipple
                  onPress={() => setOptionalOpen((o) => !o)}
                  style={styles.toggleRow}
                  borderless
                >
                  <View style={styles.toggleInner}>
                    <Icon
                      source={optionalOpen ? 'chevron-down' : 'chevron-right'}
                      size={20}
                      color={colors.textSecondary}
                    />
                    <Text style={styles.toggleText}>
                      Ürün / renk / kalite / en {optionalOpen ? '' : '(opsiyonel)'}
                    </Text>
                  </View>
                </TouchableRipple>

                {optionalOpen && (
                  <View style={styles.optionalBox}>
                    {/* Ürün */}
                    <Text style={styles.label}>Ürün</Text>
                    <SelectRow
                      text={itemLabel ?? 'İş emrinin hedef ürünü'}
                      muted={!itemLabel}
                      disabled={busy}
                      onPress={() => {
                        setItemCatalogWanted(true);
                        setPicker('item');
                      }}
                      onClear={itemId ? () => { setItemId(null); setItemLabel(null); } : undefined}
                    />
                    {itemsQuery.isError && (
                      <Text style={styles.errorNote}>
                        Ürün listesi açılamadı ({itemsQuery.error instanceof Error
                          ? itemsQuery.error.message
                          : 'yetki yok'}) — iş emrinin hedef ürünü kullanılacak.
                      </Text>
                    )}

                    {/* Renk — üç değerli */}
                    <Text style={styles.label}>Renk</Text>
                    <View style={styles.chipRow}>
                      <ModeChip
                        label="İş emri rengi"
                        active={colorMode === 'inherit'}
                        disabled={busy}
                        onPress={() => {
                          setColorMode('inherit');
                          setColorId(null);
                          setColorLabel(null);
                        }}
                      />
                      <ModeChip
                        label="Renksiz"
                        active={colorMode === 'none'}
                        disabled={busy}
                        onPress={() => {
                          setColorMode('none');
                          setColorId(null);
                          setColorLabel(null);
                        }}
                      />
                      <ModeChip
                        label={colorMode === 'pick' && colorLabel ? colorLabel : 'Renk seç…'}
                        active={colorMode === 'pick'}
                        disabled={busy}
                        onPress={() => {
                          setColorCatalogWanted(true);
                          setPicker('color');
                        }}
                      />
                    </View>
                    {colorsQuery.isError && (
                      <Text style={styles.errorNote}>
                        Renk listesi açılamadı ({colorsQuery.error instanceof Error
                          ? colorsQuery.error.message
                          : 'yetki yok'}) — iş emrinin hedef rengi kullanılacak.
                      </Text>
                    )}

                    {/* Kalite */}
                    <Text style={styles.label}>Kalite</Text>
                    <View style={styles.chipRow}>
                      <ModeChip
                        label="Belirsiz"
                        active={qualityCode === null}
                        disabled={busy}
                        onPress={() => setQualityCode(null)}
                      />
                      {qualityGrades.map((qg) => (
                        <ModeChip
                          key={qg.id}
                          label={qg.name}
                          active={qualityCode === qg.code}
                          disabled={busy}
                          onPress={() => setQualityCode(qg.code)}
                        />
                      ))}
                    </View>

                    {/* En */}
                    <Text style={styles.label}>En (cm)</Text>
                    <NumpadInput
                      mode="outlined"
                      dense
                      useNativeKeyboard
                      value={width}
                      onChangeText={setWidth}
                      placeholder="opsiyonel — örn. 150"
                      disabled={busy}
                      style={styles.input}
                    />
                  </View>
                )}
              </>
            ) : (
              /* ── ONAY: ne yaratılacağını SOMUT yaz ── */
              <>
                <View style={styles.confirmHeadRow}>
                  <Icon source="alert-circle-outline" size={20} color={colors.warningText} />
                  <Text style={styles.confirmHead}>Şu top OLUŞTURULACAK</Text>
                </View>
                <View style={styles.summaryBox}>
                  <SummaryRow label="Metraj" value={`${qtyNum} m`} />
                  <SummaryRow label="Ürün" value={itemLabel ?? 'İş emrinin hedef ürünü'} />
                  <SummaryRow label="Renk" value={colorSummary} />
                  <SummaryRow label="Kalite" value={qualityName} />
                  <SummaryRow label="En" value={widthNum !== null ? `${widthNum} cm` : 'Girilmedi'} />
                  <SummaryRow label="Sebep" value={reason.trim()} />
                </View>
                <View style={styles.noticeBox}>
                  <Icon source="information-outline" size={16} color={colors.infoText} />
                  <Text style={styles.noticeText}>
                    Barkod sunucuda üretilecek, top "elle eklendi" (MANUEL GİRİŞ) olarak
                    işaretlenecek ve doğrudan {stationName} adımına alınacak — hemen
                    kesebilirsin. Sebep, operatör ve makine kalıcı olarak kaydedilir.
                    Tamamlanmış bir iş emri ise yeniden açılır.
                  </Text>
                </View>
              </>
            )}
          </ScrollView>

          <View style={styles.actions}>
            {phase === 'form' ? (
              <>
                <Button mode="outlined" onPress={onDismiss} disabled={busy} style={styles.actionBtn}>
                  Vazgeç
                </Button>
                <Button
                  mode="contained"
                  icon="arrow-right"
                  onPress={goConfirm}
                  disabled={!formValid || busy}
                  buttonColor={colors.action}
                  style={styles.actionBtn}
                >
                  Devam
                </Button>
              </>
            ) : (
              <>
                <Button mode="outlined" onPress={backToForm} disabled={busy} style={styles.actionBtn}>
                  Geri
                </Button>
                <Button
                  mode="contained"
                  icon="check"
                  onPress={submit}
                  loading={busy}
                  disabled={busy || !online}
                  buttonColor={colors.action}
                  style={styles.actionBtn}
                >
                  {`Evet, ${qtyNum} m ekle`}
                </Button>
              </>
            )}
          </View>
        </Surface>
      </AppModal>

      <PickerModal
        visible={picker === 'item'}
        title="Ürün Seç"
        options={itemOptions}
        selectedValue={itemId}
        loading={itemsQuery.isLoading}
        emptyText={itemsQuery.isError ? 'Ürün listesi açılamadı' : 'Ürün bulunamadı'}
        onSelect={(value) => {
          setItemId(value);
          setItemLabel(itemOptions.find((o) => o.value === value)?.label ?? null);
          setPicker(null);
        }}
        onDismiss={() => setPicker(null)}
      />

      <PickerModal
        visible={picker === 'color'}
        title="Renk Seç"
        options={colorOptions}
        selectedValue={colorId}
        loading={colorsQuery.isLoading}
        emptyText={colorsQuery.isError ? 'Renk listesi açılamadı' : 'Renk bulunamadı'}
        onSelect={(value) => {
          setColorId(value);
          setColorLabel(colorOptions.find((o) => o.value === value)?.label ?? null);
          setColorMode('pick');
          setPicker(null);
        }}
        onDismiss={() => setPicker(null)}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SelectRow({
  text,
  muted,
  disabled,
  onPress,
  onClear,
}: {
  text: string;
  muted?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onClear?: () => void;
}) {
  return (
    <View style={styles.selectRow}>
      <TouchableRipple
        onPress={disabled ? undefined : onPress}
        style={[styles.selectBox, disabled && styles.selectBoxDisabled]}
        borderless
      >
        <View style={styles.selectInner}>
          <Text style={[styles.selectText, muted && styles.selectTextMuted]} numberOfLines={1}>
            {text}
          </Text>
          <Icon source="chevron-down" size={20} color={colors.textSecondary} />
        </View>
      </TouchableRipple>
      {onClear && (
        <IconButton icon="close" size={18} onPress={onClear} accessibilityLabel="Temizle" />
      )}
    </View>
  );
}

function ModeChip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      onPress={disabled ? undefined : onPress}
      style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
      borderless
      rippleColor="rgba(79,70,229,0.12)"
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableRipple>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    // AppModal'ın center sarmalayıcısı alignItems:'center' verir → width'siz bir
    // sheet içeriğine büzülürdü (dar/asimetrik form). stretch, sarmalayıcının
    // min(ekran-32, 560) genişliğini doldurur.
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textSecondary },

  offlineBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningContainer,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  offlineText: { flex: 1, fontSize: 12, color: colors.warningText },

  scrollBody: { gap: spacing.sm, paddingBottom: spacing.xs },

  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.infoContainer,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: { flex: 1, fontSize: 12, color: colors.infoText, lineHeight: 17 },

  label: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 2 },
  req: { color: colors.danger },
  input: { backgroundColor: colors.surface, fontSize: 15 },
  hintSmall: { fontSize: 11, color: colors.textMuted, marginTop: 2, lineHeight: 15 },
  errorNote: { fontSize: 11, color: colors.dangerDark, lineHeight: 15 },

  toggleRow: { borderRadius: radius.sm },
  toggleInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  toggleText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },

  optionalBox: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },

  selectRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  selectBox: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  selectBoxDisabled: { opacity: 0.5 },
  selectInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  selectText: { flex: 1, fontSize: 15, color: colors.text },
  selectTextMuted: { color: colors.textMuted },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, maxWidth: 180 },
  chipTextActive: { color: colors.textOnDark },

  confirmHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confirmHead: { fontSize: 15, fontWeight: '800', color: colors.text },
  summaryBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  summaryLabel: { width: 78, fontSize: 13, color: colors.textSecondary },
  summaryValue: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },

  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1 },
});
