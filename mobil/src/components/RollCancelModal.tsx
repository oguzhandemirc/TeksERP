import React, { useEffect, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Text,
  Button,
  Icon,
  ActivityIndicator,
  TouchableRipple,
  TextInput as PaperTextInput,
} from 'react-native-paper';

import AppModal from './AppModal';
import { CANCEL_MIN_REASON } from '../constants/cancelReasons';
import { useReasonPresets } from '../hooks/useReasonPresets';
import { usePermissions } from '../hooks/usePermission';
import ReasonPresetManagerSheet from './reasonPresets/ReasonPresetManagerSheet';
import type { RollCancelPreview } from '../services/roll.service';
import type { Roll } from '../types/models';
import { colors } from '../theme';

// =============================================================================
// TOP İPTAL ONAYI — okutulan/seçilen bir topu stoktan düşürmeden önceki tek kapı.
//
// ⚠️ ORTAK BİLEŞEN: KK1 (Ham Giriş "Sil") ve Depo ("Stoktan Kaldır") aynı ucu
// (`DELETE /rolls/:id`) aynı guard'larla çağırır. Kopyalanırsa iki ekran aynı
// işlem için farklı uyarı gösterir ve ölü etiket kuralı bir tarafta sessizce
// eksik kalır — guard backend'de olduğu için hata da vermez, yalnız operatör
// uyarılmamış olur. Yeni bir iptal yüzeyi eklerken bu bileşeni kullan.
//
// Üç ayrı eksen:
//   • `canCancel=false`  → hard-block (sevk/fason/tüketim) — onay butonu YOK.
//   • `requiresConfirm`  → mal bir istasyonda/iş emrinde aktif (sistem İÇİ etki).
//   • `labelPrinted`     → topun üstünde fiziksel etiket var (sistem DIŞI etki).
// Bir top ikisini birden tetikleyebilir.
//
// ── SADELEŞTİRME (2026-08-06, saha geri bildirimi) ──────────────────────────
// Ölü etiket uyarısı KENDİ KENARLIKLI KUTUSUNDA, kendi başlığı ve ikonuyla
// çiziliyordu; içine "İptal sebebi (zorunlu)" + 6 uzun chip + gizli metin kutusu
// da girince ekranda MODAL İÇİNDE MODAL görünüyordu (sahadan gelen şikâyet birebir
// buydu: "iki modal üst üste çıkıyor"). Üç değişiklik:
//   [1] Kart kalktı — uyarı tek satırlık kehribar bir cümle. Kimlik bloğu da
//       etiketli üç satırdan iki satıra indi (barkod + "ürün · metraj · en").
//   [2] SEBEP OPSİYONEL ve KAPALI başlar. Zorunluluk operatörü rastgele kategori
//       seçmeye itiyordu ve o cevap, cevapsızlıktan kötüdür (denetimde dolu
//       görünür, hiçbir şey söylemez — `manualReasons.ts` ile aynı ders).
//       Backend de gevşetildi: sebepsiz iptal geçer, `cancelReason` NULL kalır.
//   [3] Chip DOKUNUNCA İPTAL EDER — "seç, sonra onayla" iki dokunuşu kalktı.
//       Emniyeti chip'in kendisi değil, sonrasındaki GERİ AL sağlar (KK1 toast'ı
//       → `POST /rolls/:id/restore-cancel`). Bu yüzden chip başlığı ne yaptığını
//       AÇIKÇA yazar; "Sebep" gibi nötr bir başlık seçim sanılırdı.
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
  onDismiss: () => void;
  /**
   * Sebep OPSİYONEL (2026-08-06): seçilmediyse `undefined` gider ve kayıt
   * sebepsiz iptal olarak düşer. ⚠️ Çağıran, etiketli topta `confirmLabelPrinted`
   * bayrağını KENDİ önizlemesinden türetir — eskiden "sebep varsa onay da vardır"
   * diye çıkarılıyordu ve sebep opsiyonelleşince o çıkarım sessizce 409 üretirdi.
   */
  onConfirm: (reason?: string) => void;
  /**
   * Başlık/onay metnini çağıran bağlama uyarlar. Varsayılan KK1'in dilidir
   * ("Topu iptal et?" / "İptal Et"); Depo aynı işlemi operatörün diliyle
   * "Stoktan kaldır?" diye sorar. Yalnız SÖZCÜK değişir — guard'lar, sebep
   * zorunluluğu ve uyarı kutuları her iki yüzeyde de birebir aynıdır.
   */
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

export default function RollCancelModal({
  roll,
  preview,
  previewLoading,
  previewError,
  offline,
  loading,
  onDismiss,
  onConfirm,
  copy = KK1_COPY,
}: RollCancelModalProps) {
  const { width: winW } = useWindowDimensions();
  const sheetWidth = Math.min(winW * 0.9, 460);

  // Önizleme henüz gelmedi → güvenli tarafta kal (onay butonu beklemede).
  const blocked = !offline && !!preview && !preview.canCancel;
  const needsConfirm = !!preview && preview.canCancel && preview.requiresConfirm;

  // ── ÖLÜ ETİKET EKSENİ (2026-08-05) ────────────────────────────────────────
  // `needsConfirm`'den AYRI soru: o "mal bir istasyonda mı" (sistem içi etki),
  // bu "sahaya geçersiz bir kâğıt bırakıyor muyum" (sistem DIŞI etki). Bir top
  // ikisini birden tetikleyebilir; ikisi de kendi uyarısını gösterir.
  const labelPrinted = !offline && !!preview && preview.canCancel && preview.labelPrinted;

  // Sebep KAPALI başlar ve opsiyoneldir (bkz. dosya başı [2]). Açıkken chip'ler
  // ekranın yarısını kaplıyor ve operatör onu zorunlu alan sanıyordu.
  const [reasonOpen, setReasonOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  // Hazır iptal sebepleri artık düzenlenebilir katalogdan gelir.
  const { presets: cancelPresets, isFallback: cancelPresetsOffline } =
    useReasonPresets('ROLL_CANCEL');
  const { has: hasPermission } = usePermissions();
  const canEditPresets =
    hasPermission('roll:manual-adjust') || hasPermission('mobile:tambur-duzelt');
  const [managerOpen, setManagerOpen] = useState(false);
  // Modal her açılışta temiz başlamalı — önceki topun sebebi yenisine sızmasın.
  useEffect(() => {
    if (roll) {
      setReasonOpen(false);
      setOtherOpen(false);
      setOtherText('');
    }
  }, [roll?.id]);

  // Hard-block iken hiç gönderme. Önizleme yüklenirken de kilitle ki operatör
  // requiresConfirm bilinmeden iptal etmesin. Offline'da önizleme yok → kilitleme
  // (kuyruğa alınır, backend replay'de güvenliği uygular).
  // ⚠️ SEBEP ARTIK KİLİT DEĞİL: iptal tek dokunuşta bitmeli.
  const confirmDisabled = loading || (!offline && previewLoading) || blocked;

  /** Tek çıkış kapısı — chip'ler de ana buton da buradan geçer. */
  const submit = (reason?: string) => {
    if (confirmDisabled) return;
    onConfirm(reason);
  };
  // Serbest metin yalnız anlamlıysa gider; kısa doldurma sebepsiz sayılır
  // (backend de aynı elemeyi yapar — iki katman aynı şeyi söylesin).
  const typed = otherText.trim();
  const typedReason = typed.length >= CANCEL_MIN_REASON ? typed : undefined;

  // Onay rengi/etiketi duruma göre.
  const accent = blocked
    ? colors.danger
    : needsConfirm || labelPrinted
      ? colors.warningDark
      : '#dc2626';
  const confirmColor = needsConfirm || labelPrinted ? colors.warningDark : '#dc2626';
  // Etiketli iptalde onay metni "kâğıdı söktüm" beyanını taşır ve yan yana
  // düzende kesiliyordu ("Etiketi Söktüm, İpta…") → o durumda butonlar alt alta.
  const confirmLabel = labelPrinted
    ? `Etiketi söktüm — ${copy.confirm}`
    : needsConfirm
      ? `Yine de ${copy.confirm}`
      : copy.confirm;
  const stackedActions = labelPrinted;
  const confirmButton = blocked ? null : (
    <Button
      mode="contained"
      buttonColor={confirmColor}
      textColor="#fff"
      icon="trash-can-outline"
      onPress={() => submit(typedReason)}
      loading={loading}
      disabled={confirmDisabled}
      style={rollCancelStyles.actionBtn}
      contentStyle={rollCancelStyles.actionBtnContent}
    >
      {confirmLabel}
    </Button>
  );

  // Kimlik satırı: "ALP · Kırmızı · 125 mt · 180 cm". Etiketli üç satır yerine tek
  // satır — operatörün karşılaştırdığı şey barkod, gerisi teyit.
  const metaLine = roll
    ? [
        [roll.item?.name, roll.color?.name].filter(Boolean).join(' · ') || null,
        `${roll.initialQty} mt`,
        roll.width != null ? `${roll.width} cm` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <AppModal visible={!!roll} onDismiss={onDismiss} dismissable={!loading}>
      <View style={[rollCancelStyles.sheet, { width: sheetWidth }]}>
        <View
          style={[
            rollCancelStyles.iconCircle,
            needsConfirm && { backgroundColor: '#fffbeb' },
          ]}
        >
          <Icon
            source={blocked ? 'cancel' : 'alert-circle-outline'}
            size={36}
            color={accent}
          />
        </View>
        <Text variant="titleLarge" style={rollCancelStyles.title}>
          {blocked ? copy.blockedTitle : copy.title}
        </Text>

        {roll && (
          <View style={rollCancelStyles.idBox}>
            <Text style={rollCancelStyles.idBarcode} numberOfLines={1}>
              {roll.barcode ?? '—'}
            </Text>
            <Text style={rollCancelStyles.idMeta} numberOfLines={2}>
              {metaLine}
            </Text>
          </View>
        )}

        {/* Önizleme durum bölümü */}
        {offline ? (
          <View style={rollCancelStyles.warnBox}>
            <Icon source="wifi-off" size={18} color={colors.warningDark} />
            <View style={{ flex: 1 }}>
              <Text style={rollCancelStyles.warnText}>
                Çevrimdışısın — durum önizlemesi yok.
              </Text>
              <Text style={rollCancelStyles.warnSub}>
                İptal sıraya alınır, bağlanınca uygulanır. Top bu sırada bir
                istasyonda aktifleştiyse sunucu reddedebilir.
              </Text>
            </View>
          </View>
        ) : previewLoading ? (
          <View style={rollCancelStyles.previewLoadingRow}>
            <ActivityIndicator size="small" color="#64748b" />
            <Text style={rollCancelStyles.previewLoadingText}>
              Durum kontrol ediliyor…
            </Text>
          </View>
        ) : blocked ? (
          <View style={rollCancelStyles.blockBox}>
            <Icon source="information-outline" size={18} color={colors.danger} />
            <Text style={rollCancelStyles.blockText}>{preview!.blockReason}</Text>
          </View>
        ) : needsConfirm ? (
          <View style={rollCancelStyles.warnBox}>
            <Icon source="alert" size={18} color={colors.warningDark} />
            <View style={{ flex: 1 }}>
              <Text style={rollCancelStyles.warnText}>
                {activeAtText(preview!.activeAt)}
              </Text>
              <Text style={rollCancelStyles.warnSub}>
                İptal edilirse bu adımdan düşülür ve adım durumu geri sarılır.
                Yine de iptal etmek istiyor musun?
              </Text>
            </View>
          </View>
        ) : (
          <>
            {previewError && (
              <Text style={rollCancelStyles.previewErrText}>
                Durum doğrulanamadı — yine de deneyebilirsin.
              </Text>
            )}
            {/* Etiket uyarısı varken genel açıklama BASTIRILIR: iki ayrı metin
                aynı anda okunmuyor ve önemli olan hangisi belirsizleşiyordu. */}
            {!labelPrinted && <Text style={rollCancelStyles.hint}>{copy.hint}</Text>}
          </>
        )}

        {/* ── ÖLÜ ETİKET UYARISI ──────────────────────────────────────────────
            Etiket basmak fiziksel dünyada geri alınamaz; kayıt geri alınabilir.
            Bu satır tam o farkı söyler: kâğıt topun üstünde KALACAK. Sahada olan
            buydu — uyarı yoktu, kayıt öldü, kâğıt kaldı, aynı top saatler sonra
            ikinci bir barkodla yeniden girildi.
            ⚠️ Kutu değil SATIR: kendi kenarlığı + başlığıyla çizilince modal
            içinde ikinci bir modal gibi okunuyordu. */}
        {labelPrinted && (
          <View style={rollCancelStyles.warnRow}>
            <Icon source="label-off-outline" size={18} color={colors.warningDark} />
            <Text style={rollCancelStyles.warnRowText}>
              Etiketi basıldı — iptal etmeden önce kâğıdı toptan sök.
            </Text>
          </View>
        )}

        {/* ── SEBEP (opsiyonel, kapalı başlar) ────────────────────────────────
            Kapalıyken tek satır; açıkken chip'ler DOĞRUDAN iptal eder. */}
        {!blocked &&
          (reasonOpen ? (
            <View style={rollCancelStyles.reasonWrap}>
              <Text style={rollCancelStyles.reasonLabel}>
                Sebebi seç — dokununca iptal olur
              </Text>
              <View style={rollCancelStyles.reasonChips}>
                {/* Liste SUNUCUDAN gelir (fabrika düzenleyebilsin); çevrimdışında
                    cihazdaki son liste, o da yoksa APK'ya gömülü zemin. Kayda
                    yazılan değer `fullText`tir — geçmişle gruplama ona dayanır. */}
                {cancelPresets.map((p) => (
                  <TouchableRipple
                    key={p.code}
                    onPress={() => submit(p.fullText ?? p.label)}
                    disabled={confirmDisabled}
                    style={rollCancelStyles.reasonChip}
                    borderless
                  >
                    <Text style={rollCancelStyles.reasonChipText}>{p.label}</Text>
                  </TouchableRipple>
                ))}
                {/* Serbest yazım kaldırılmadı, "Diğer"in altına alındı: hazır
                    seçenek sürtünmeyi kaldırır ve veriyi sayılabilir yapar, ama
                    katalog dışı gerçek durumlar da olur. Tek dokunuşla iptal
                    EDEMEZ — yazılacak metin var, onayı aşağıdaki buton verir. */}
                {/* ⚠️ Satır içi kalem YOK: bu chip'ler DOKUNUNCA TOPU İPTAL EDER.
                    Yıkıcı bir aksiyonun yanına düzenleme tuşu koymak, ıskalanan
                    her dokunuşu iptal edilmiş bir top yapardı. Düzenleme ayrı
                    yüzeyde (ReasonPresetManagerSheet). */}
                {canEditPresets && !cancelPresetsOffline && (
                  <TouchableRipple
                    onPress={() => setManagerOpen(true)}
                    style={rollCancelStyles.reasonChip}
                    borderless
                    accessibilityLabel="Hazır iptal sebeplerini düzenle"
                  >
                    <Text style={rollCancelStyles.reasonChipText}>✏️ Sebepleri düzenle</Text>
                  </TouchableRipple>
                )}
                <TouchableRipple
                  onPress={() => setOtherOpen((v) => !v)}
                  style={[
                    rollCancelStyles.reasonChip,
                    otherOpen && rollCancelStyles.reasonChipOn,
                  ]}
                  borderless
                >
                  <Text
                    style={[
                      rollCancelStyles.reasonChipText,
                      otherOpen && rollCancelStyles.reasonChipTextOn,
                    ]}
                  >
                    Diğer…
                  </Text>
                </TouchableRipple>
              </View>
              {otherOpen && (
                <PaperTextInput
                  mode="outlined"
                  dense
                  autoFocus
                  placeholder="Sebebi yaz, sonra alttaki butona bas"
                  value={otherText}
                  onChangeText={setOtherText}
                  maxLength={500}
                  style={rollCancelStyles.reasonInput}
                />
              )}
            </View>
          ) : (
            <TouchableRipple
              onPress={() => setReasonOpen(true)}
              style={rollCancelStyles.reasonToggle}
              borderless
            >
              <View style={rollCancelStyles.reasonToggleInner}>
                <Icon source="comment-plus-outline" size={16} color="#64748b" />
                <Text style={rollCancelStyles.reasonToggleText}>
                  Sebep ekle (opsiyonel)
                </Text>
              </View>
            </TouchableRipple>
          ))}

        {/* Yatay sıra (Vazgeç solda) KORUNUR — kas hafızası. Yalnız etiketli
            iptalde alt alta geçilir, çünkü onay metni "kâğıdı söktüm" beyanını
            taşıyor ve yan yana düzende kesiliyordu ("Etiketi Söktüm, İpta…").
            Yığılmış düzende Vazgeç ALTTA: baş parmağın en kolay eriştiği yer en
            zararsız aksiyon olmalı. */}
        <View style={stackedActions ? rollCancelStyles.actionsStacked : rollCancelStyles.actions}>
          {stackedActions && confirmButton}
          <Button
            mode="outlined"
            onPress={onDismiss}
            disabled={loading}
            style={rollCancelStyles.actionBtn}
            contentStyle={rollCancelStyles.actionBtnContent}
          >
            {blocked ? 'Kapat' : 'Vazgeç'}
          </Button>
          {!stackedActions && confirmButton}
        </View>
      </View>

      <ReasonPresetManagerSheet
        visible={managerOpen}
        kind="ROLL_CANCEL"
        onDismiss={() => setManagerOpen(false)}
      />
    </AppModal>
  );
}

/**
 * Görsel dil — stil adları bilerek JENERİK (sheet/title/infoBox/actions), çünkü
 * KK1'in "AYRI TOP" çakışma modalı da bunu paylaşır. İkinci bir kopya blok,
 * onay modalları arasında sessiz görsel ayrışma üretirdi.
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
  // ── Kimlik bloğu: barkod + tek satır özet (eski 3 etiketli satırın yerine) ──
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
  // ⚠️ `idBox` KK1'in "Aynı top mu, ayrı top mu?" çakışma modalıyla PAYLAŞILIR —
  // iki onay yüzeyi de barkodu aynı biçimde gösterir. Eski etiketli `infoBox`
  // ailesi (Barkod/Ürün/Metraj satırları) 2026-08-06'da ikisinden de düştü.
  hint: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  // Etiketli iptal: onay metni uzun → alt alta, tam genişlik.
  actionsStacked: { flexDirection: 'column', gap: 8, marginTop: 4 },
  actionBtn: { flex: 1, borderRadius: 10 },
  actionBtnContent: { height: 48 },
  previewLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  previewLoadingText: { fontSize: 13, color: '#64748b' },
  previewErrText: {
    fontSize: 12,
    color: colors.warningDark,
    textAlign: 'center',
  },
  // Engelli (hard-block): kırmızı bilgi kutusu
  blockBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
  },
  blockText: {
    flex: 1,
    fontSize: 13,
    color: '#991b1b',
    fontWeight: '600',
    lineHeight: 18,
  },
  // İstasyonda aktif uyarısı: kehribar kutu
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  warnText: {
    fontSize: 14,
    color: '#92400e',
    fontWeight: '700',
    lineHeight: 19,
  },
  warnSub: {
    fontSize: 12.5,
    color: '#b45309',
    lineHeight: 17,
    marginTop: 3,
  },
  // ── Ölü etiket: KUTU DEĞİL SATIR (kart-içinde-kart görünümü kalktı) ──
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  warnRowText: {
    flex: 1,
    fontSize: 13.5,
    color: '#92400e',
    fontWeight: '700',
    lineHeight: 18,
  },
  // ── Sebep: kapalı tetik + açık chip alanı ──
  reasonToggle: { alignSelf: 'center', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  reasonToggleInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reasonToggleText: { fontSize: 13, color: '#64748b', fontWeight: '700' },
  reasonWrap: { gap: 8 },
  reasonLabel: { fontSize: 12.5, fontWeight: '700', color: '#64748b' },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: {
    borderWidth: 1,
    borderColor: '#fcd34d',
    backgroundColor: '#fffbeb',
    borderRadius: 999,
    paddingHorizontal: 14,
    // 44dp: chip artık SEÇİM değil AKSİYON (dokununca iptal eder) — eldivenli
    // parmak için ana butonlara yaklaşan bir hedef alanı hak ediyor.
    minHeight: 44,
    justifyContent: 'center',
  },
  reasonChipOn: { backgroundColor: colors.warningDark, borderColor: colors.warningDark },
  reasonChipText: { fontSize: 13.5, color: '#92400e', fontWeight: '700' },
  reasonChipTextOn: { color: '#fff' },
  reasonInput: { backgroundColor: '#fff' },
});
