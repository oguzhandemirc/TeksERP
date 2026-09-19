import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';

import ModuleSheet, { sheet } from './ModuleSheet';
import ModalTextInput from './ModalTextInput';
import ReasonPresetManagerSheet from './reasonPresets/ReasonPresetManagerSheet';
import { mainConfirmLocked, reasonRequiredOf, typedReasonOf } from './rollCancelRules';
import { useReasonPresets } from '../hooks/useReasonPresets';
import { usePermissions } from '../hooks/usePermission';
import type { RollCancelPreview } from '../services/roll.service';
import type { Roll } from '../types/models';
import { colors, radius, spacing, typography } from '../theme';

// =============================================================================
// TOP İPTAL ONAYI — okutulan/seçilen bir topu stoktan düşürmeden önceki tek kapı (tek kart, `ModuleSheet`).
// ⚠️ ORTAK BİLEŞEN: KK1 ("Sil") ve Depo ("Stoktan Kaldır") aynı ucu (`DELETE /rolls/:id`) aynı guard'larla
// çağırır; kopyalanırsa iki ekran aynı işlem için farklı uyarı gösterir. Yeni iptal yüzeyi bunu kullanır.
// Üç eksen: `canCancel=false` hard-block (onay yok) · `requiresConfirm` istasyonda aktif (sistem İÇİ etki) ·
// `labelPrinted` kâğıt topun üstünde (sistem DIŞI etki) — bir top ikisini birden tetikleyebilir.
// SEBEP varsayılan OPSİYONEL ve kapalı başlar (zorunlu tutmak operatörü rastgele kategori seçmeye itiyordu; o
// cevap cevapsızlıktan kötü). `production.cancelReasonRequired` AÇIKKEN zorunluluk SUNUCUDAN okunur — önizleme
// `reasonRequired` ya da 400 reddi (`submitError`) — tahmin edilmez; eski sunucu alanı göndermez → opsiyonel.
// Chip DOKUNUNCA İPTAL EDER (tek dokunuş; emniyet sonrasındaki GERİ AL) ve sebebi kendisi taşır — zorunlu kipte
// de açık kalır; ana düğme yalnız serbest metinle ("Diğer…") çalışır, sebep yokken kilitli.
// =============================================================================

export interface RollCancelModalProps {
  roll: Roll | null;
  /** Backend iptal önizlemesi (null = henüz gelmedi). */
  preview: RollCancelPreview | null;
  previewLoading: boolean;
  previewError: Error | null;
  /** Çevrimdışı → önizleme yok; iptal kuyruğa alınır, bağlanınca uygulanır. */
  offline: boolean;
  loading: boolean;
  /** Sunucu reddi (400 CANCEL_REASON_REQUIRED) — satır olarak çizilir, sebep alanı zorunlu açılır; null = yok. */
  submitError?: string | null;
  onDismiss: () => void;
  /**
   * Sebep seçilmediyse `undefined` gider. ⚠️ Çağıran, etiketli topta `confirmLabelPrinted`
   * bayrağını KENDİ önizlemesinden türetir — "sebep varsa onay da vardır" çıkarımı geçersiz.
   */
  onConfirm: (reason?: string) => void;
  /** Başlık/onay sözcükleri çağıranın dilinde (KK1 "İptal Et" · Depo "Stoktan Kaldır"); guard'lar aynı. */
  copy?: RollCancelCopy;
}

export interface RollCancelCopy {
  title: string;
  blockedTitle: string;
  confirm: string;
  /** Hard-block / uyarı yokken gösterilen açıklama satırı. */
  hint: string;
}

const KK1_COPY: RollCancelCopy = {
  title: 'Topu iptal et?',
  blockedTitle: 'Top iptal edilemez',
  confirm: 'İptal Et',
  hint:
    'Yanlış giriş için kullan. İptal edilen toplar fire sayılmaz, sadece kayıt geri alınır.',
};

/** "X iş emrinin Y adımında aktif" gibi okunur cümle. */
function activeAtText(activeAt: RollCancelPreview['activeAt']): string {
  if (!activeAt) return 'Bu top bir istasyonda/iş emrinde aktif.';
  const wo = activeAt.batchNumber ? `"${activeAt.batchNumber}"` : 'bir';
  const station = activeAt.stationName ?? 'bir istasyon';
  return `Bu top ${wo} iş emrinin "${station}" adımında aktif.`;
}

/** Kimlik satırı: "ürün · renk · 125 mt · 180 cm" — operatörün karşılaştırdığı şey barkod, gerisi teyit. */
function metaLine(roll: Roll): string {
  return [
    [roll.item?.name, roll.color?.name].filter(Boolean).join(' · ') || null,
    `${roll.initialQty} mt`,
    roll.width != null ? `${roll.width} cm` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

interface StatusProps {
  offline: boolean;
  previewLoading: boolean;
  blocked: boolean;
  needsConfirm: boolean;
  labelPrinted: boolean;
  preview: RollCancelPreview | null;
  previewError: Error | null;
  hint: string;
}

/** Önizleme durumu — çevrimdışı · yükleniyor · engelli · istasyonda aktif · sade açıklama; biri çizilir. */
function PreviewStatus(p: StatusProps) {
  if (p.offline) {
    return (
      <View style={styles.warnBox}>
        <Icon source="wifi-off" size={18} color={colors.warningDark} />
        <View style={styles.grow}>
          <Text style={styles.warnText}>Çevrimdışısın — durum önizlemesi yok.</Text>
          <Text style={styles.warnSub}>
            İptal sıraya alınır, bağlanınca uygulanır. Top bu sırada bir istasyonda aktifleştiyse
            sunucu reddedebilir.
          </Text>
        </View>
      </View>
    );
  }
  if (p.previewLoading) {
    return (
      <View style={styles.previewLoadingRow}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
        <Text style={styles.previewLoadingText}>Durum kontrol ediliyor…</Text>
      </View>
    );
  }
  if (p.blocked) {
    return (
      <View style={styles.blockBox}>
        <Icon source="information-outline" size={18} color={colors.danger} />
        <Text style={styles.blockText}>{p.preview?.blockReason}</Text>
      </View>
    );
  }
  if (p.needsConfirm) {
    return (
      <View style={styles.warnBox}>
        <Icon source="alert" size={18} color={colors.warningDark} />
        <View style={styles.grow}>
          <Text style={styles.warnText}>{activeAtText(p.preview?.activeAt ?? null)}</Text>
          <Text style={styles.warnSub}>
            İptal edilirse bu adımdan düşülür ve adım durumu geri sarılır. Yine de iptal etmek istiyor
            musun?
          </Text>
        </View>
      </View>
    );
  }
  return (
    <>
      {p.previewError && (
        <Text style={styles.previewErrText}>Durum doğrulanamadı — yine de deneyebilirsin.</Text>
      )}
      {/* Etiket uyarısı varken genel açıklama BASTIRILIR: iki metin aynı anda okunmuyor. */}
      {!p.labelPrinted && <Text style={styles.hint}>{p.hint}</Text>}
    </>
  );
}

interface ReasonProps {
  required: boolean;
  disabled: boolean;
  otherText: string;
  onOtherText: (t: string) => void;
  onPick: (reason: string) => void;
  onEditPresets: () => void;
  confirmWord: string;
}

/** Sebep alanı: chip'ler DOĞRUDAN iptal eder; "Diğer…" metni ana düğmeyle gider. */
function ReasonSection(p: ReasonProps) {
  const [otherOpen, setOtherOpen] = useState(false);
  // Liste SUNUCUDAN (fabrika düzenler); çevrimdışında son liste, o da yoksa APK zemini. Kayda `fullText` yazılır.
  const { presets, isFallback } = useReasonPresets('ROLL_CANCEL');
  const { has } = usePermissions();
  const canEditPresets = has('roll:manual-adjust') || has('mobile:tambur-duzelt');
  return (
    <View style={styles.reasonWrap}>
      <Text style={styles.reasonLabel}>
        {p.required
          ? 'Sebep * — zorunlu (ayar: iptalde sebep zorunlu). Dokununca iptal olur.'
          : 'Sebebi seç — dokununca iptal olur'}
      </Text>
      <View style={styles.reasonChips}>
        {presets.map((c) => (
          <TouchableRipple
            key={c.code}
            onPress={() => p.onPick(c.fullText ?? c.label)}
            disabled={p.disabled}
            style={styles.reasonChip}
            borderless
          >
            <Text style={styles.reasonChipText}>{c.label}</Text>
          </TouchableRipple>
        ))}
        {/* ⚠️ Satır içi kalem YOK: chip'ler topu İPTAL EDER; düzenleme ayrı yüzeyde (ManagerSheet). */}
        {canEditPresets && !isFallback && (
          <TouchableRipple
            onPress={p.onEditPresets}
            style={styles.reasonChip}
            borderless
            accessibilityLabel="Hazır iptal sebeplerini düzenle"
          >
            <Text style={styles.reasonChipText}>✏️ Sebepleri düzenle</Text>
          </TouchableRipple>
        )}
        <TouchableRipple
          onPress={() => setOtherOpen((v) => !v)}
          style={[styles.reasonChip, otherOpen && styles.reasonChipOn]}
          borderless
        >
          <Text style={[styles.reasonChipText, otherOpen && styles.reasonChipTextOn]}>Diğer…</Text>
        </TouchableRipple>
      </View>
      {otherOpen && (
        <ModalTextInput
          mode="outlined"
          dense
          autoFocus
          placeholder={`Sebebi yaz, sonra "${p.confirmWord}" düğmesine bas`}
          value={p.otherText}
          onChangeText={p.onOtherText}
          maxLength={500}
          style={sheet.input}
          testID="cancel-other-text"
        />
      )}
    </View>
  );
}

export default function RollCancelModal({
  roll,
  preview,
  previewLoading,
  previewError,
  offline,
  loading,
  submitError = null,
  onDismiss,
  onConfirm,
  copy = KK1_COPY,
}: RollCancelModalProps) {
  // Önizleme henüz gelmedi → güvenli tarafta kal (onay butonu beklemede).
  const blocked = !offline && !!preview && !preview.canCancel;
  const needsConfirm = !!preview && preview.canCancel && preview.requiresConfirm;
  const labelPrinted = !offline && !!preview && preview.canCancel && preview.labelPrinted;
  const reasonRequired = reasonRequiredOf(preview, offline) || !!submitError;

  const [reasonOpen, setReasonOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [managerOpen, setManagerOpen] = useState(false);
  // Her açılışta temiz — önceki topun sebebi yenisine sızmasın.
  useEffect(() => {
    if (roll) {
      setReasonOpen(false);
      setOtherText('');
    }
  }, [roll?.id]);

  // Hard-block'ta hiç gönderme; önizleme yüklenirken kilitle. Çevrimdışında önizleme yok → kilitleme (kuyruk).
  const confirmDisabled = loading || (!offline && previewLoading) || blocked;
  const typedReason = typedReasonOf(otherText);
  const mainLocked = confirmDisabled || mainConfirmLocked({ reasonRequired, typedReason });
  const submit = (reason?: string) => {
    if (confirmDisabled) return;
    onConfirm(reason);
  };

  const warn = needsConfirm || labelPrinted;
  // Etiketli iptalde onay metni "kâğıdı söktüm" beyanını taşır; yan yana kesiliyordu → alt alta, Vazgeç ALTTA
  // (baş parmağın en kolay eriştiği yer en zararsız aksiyon).
  const confirmLabel = labelPrinted
    ? `Etiketi söktüm — ${copy.confirm}`
    : needsConfirm
      ? `Yine de ${copy.confirm}`
      : copy.confirm;
  const confirmButton = blocked ? null : (
    <Button
      mode="contained"
      buttonColor={warn ? colors.warningDark : colors.dangerDark}
      textColor={colors.textOnDark}
      icon="trash-can-outline"
      onPress={() => submit(typedReason)}
      loading={loading}
      disabled={mainLocked}
      style={styles.actionBtn}
      contentStyle={styles.actionBtnContent}
      testID="cancel-onay"
    >
      {confirmLabel}
    </Button>
  );

  return (
    <ModuleSheet
      visible={!!roll}
      onDismiss={onDismiss}
      dismissable={!loading}
      size="sm"
      title={blocked ? copy.blockedTitle : copy.title}
      footer={
        <View style={labelPrinted ? styles.actionsStacked : styles.actions}>
          {labelPrinted && confirmButton}
          <Button
            mode="outlined"
            onPress={onDismiss}
            disabled={loading}
            style={styles.actionBtn}
            contentStyle={styles.actionBtnContent}
          >
            {blocked ? 'Kapat' : 'Vazgeç'}
          </Button>
          {!labelPrinted && confirmButton}
        </View>
      }
      overlays={
        <ReasonPresetManagerSheet
          visible={managerOpen}
          kind="ROLL_CANCEL"
          onDismiss={() => setManagerOpen(false)}
        />
      }
    >
      {roll && (
        <View style={rollCancelStyles.idBox}>
          <Text style={rollCancelStyles.idBarcode} numberOfLines={1}>
            {roll.barcode ?? '—'}
          </Text>
          <Text style={rollCancelStyles.idMeta} numberOfLines={2}>
            {metaLine(roll)}
          </Text>
        </View>
      )}

      <PreviewStatus
        offline={offline}
        previewLoading={previewLoading}
        blocked={blocked}
        needsConfirm={needsConfirm}
        labelPrinted={labelPrinted}
        preview={preview}
        previewError={previewError}
        hint={copy.hint}
      />

      {/* Ölü etiket: kayıt geri alınır, kâğıt topun üstünde KALIR — kutu değil satır (kart-içinde-kart olmasın). */}
      {labelPrinted && (
        <View style={styles.warnRow}>
          <Icon source="label-off-outline" size={18} color={colors.warningDark} />
          <Text style={styles.warnRowText}>Etiketi basıldı — iptal etmeden önce kâğıdı toptan sök.</Text>
        </View>
      )}

      {!blocked &&
        (reasonOpen || reasonRequired ? (
          <ReasonSection
            key={roll?.id}
            required={reasonRequired}
            disabled={confirmDisabled}
            otherText={otherText}
            onOtherText={setOtherText}
            onPick={submit}
            onEditPresets={() => setManagerOpen(true)}
            confirmWord={copy.confirm}
          />
        ) : (
          <TouchableRipple onPress={() => setReasonOpen(true)} style={styles.reasonToggle} borderless>
            <View style={styles.reasonToggleInner}>
              <Icon source="comment-plus-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.reasonToggleText}>Sebep ekle (opsiyonel)</Text>
            </View>
          </TouchableRipple>
        ))}

      {submitError ? (
        <Text style={sheet.error} testID="cancel-form-error">
          {submitError}
        </Text>
      ) : null}
    </ModuleSheet>
  );
}

/**
 * ⚠️ KK1'in "Aynı top mu, ayrı top mu?" çakışma modalıyla PAYLAŞILAN görsel dil (sheet · iconCircle · title ·
 * idBox ailesi) — iki onay yüzeyi barkodu aynı biçimde gösterir; ikinci kopya sessiz görsel ayrışma üretirdi.
 */
export const rollCancelStyles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    alignItems: 'stretch',
    gap: 12,
  },
  iconCircle: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  idBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
    alignItems: 'center',
  },
  idBarcode: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 0.5,
  },
  idMeta: { fontSize: 13.5, color: '#475569', fontWeight: '600', textAlign: 'center' },
});

const styles = StyleSheet.create({
  grow: { flex: 1 },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary, lineHeight: 18, textAlign: 'center' },
  actions: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  actionsStacked: { flex: 1, flexDirection: 'column', gap: spacing.sm },
  actionBtn: { flex: 1, borderRadius: radius.md },
  actionBtnContent: { height: 48 },
  previewLoadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  previewLoadingText: { fontSize: typography.size.sm, color: colors.textSecondary },
  previewErrText: { fontSize: typography.size.xs, color: colors.warningDark, textAlign: 'center' },
  blockBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.dangerContainer, borderRadius: radius.md, padding: spacing.md },
  blockText: { flex: 1, fontSize: typography.size.sm, color: colors.dangerText, fontWeight: typography.weight.semibold, lineHeight: 18 },
  warnBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.warningContainer, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.warning },
  warnText: { fontSize: typography.size.base, color: colors.warningText, fontWeight: typography.weight.bold, lineHeight: 19 },
  warnSub: { fontSize: typography.size.sm, color: colors.warningText, lineHeight: 17, marginTop: 3 },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 2 },
  warnRowText: { flex: 1, fontSize: typography.size.sm, color: colors.warningText, fontWeight: typography.weight.bold, lineHeight: 18 },
  reasonToggle: { alignSelf: 'center', borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 10 },
  reasonToggleInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reasonToggleText: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.bold },
  reasonWrap: { gap: spacing.sm },
  reasonLabel: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.textSecondary },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // 44dp: chip SEÇİM değil AKSİYON (dokununca iptal eder) — eldivenli parmak için ana düğmeye yakın hedef.
  reasonChip: { borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningContainer, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  reasonChipOn: { backgroundColor: colors.warningDark, borderColor: colors.warningDark },
  reasonChipText: { fontSize: typography.size.sm, color: colors.warningText, fontWeight: typography.weight.bold },
  reasonChipTextOn: { color: colors.textOnDark },
});
