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

import React, { useEffect, useRef, useState } from 'react';
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
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal from '../../../components/PickerModal';
import { isWorkSessionLost } from '../../../services/api';
import {
  tamburService,
  type TamburManualRollRequest,
} from '../../../services/tambur.service';
import { generateClientUuid } from '../../../offline/barcode';
import {
  MANUAL_REASON_PRESETS,
  MANUAL_MIN_REASON,
} from '../../../constants/manualReasons';
import { colors, radius, spacing } from '../../../theme';
import type { QualityGrade } from '../../../types/models';

/** Sebep alt sınırı — "Manuel Mod" ile ORTAK (backend de aynısını uygular). */
const MIN_REASON = MANUAL_MIN_REASON;

/** `BATCH_REQUIRED` hatasında backend'in sunduğu parti seçeneği. */
interface BatchChoice {
  id: string;
  batchNumber: string;
}

/** Hata gövdesinden parti seçeneklerini güvenle çıkarır (tip daralt + doğrula). */
function readBatchChoices(err: unknown): BatchChoice[] | null {
  const details = (err as { details?: Record<string, unknown> } | null)?.details;
  if (!details || details.code !== 'BATCH_REQUIRED') return null;
  const raw = details.batches;
  if (!Array.isArray(raw)) return null;
  const list = raw.filter(
    (b): b is BatchChoice =>
      typeof (b as BatchChoice)?.id === 'string' &&
      typeof (b as BatchChoice)?.batchNumber === 'string',
  );
  return list.length > 0 ? list : null;
}

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
  // KAT — varsayılan YOK, operatör seçmeli. Ön seçim yapılsaydı acele eden
  // operatör "2-KAT" yazılı bir topu farkında olmadan onaylardı; yanlış bir kat
  // değeri, boş bir kat değerinden zararlıdır (envanterde filtrelenir, güvenilir
  // sanılır). "Kat sorulsun" kullanıcı kararı (2026-08-05).
  const [foldType, setFoldType] = useState<string | null>(null);
  // Sebep artık hazır kataloğdan seçilir; serbest yazım "Diğer" ile ikinci planda.
  const [reasonPickerOpen, setReasonPickerOpen] = useState(false);
  const [reasonFreeOpen, setReasonFreeOpen] = useState(false);
  const [reasonDraft, setReasonDraft] = useState('');
  // PARTİ — ilk istek bilerek partisiz gider; backend birden fazla açık parti
  // görürse BATCH_REQUIRED ile seçenekleri döner ve bu ikisi dolar.
  const [batchChoices, setBatchChoices] = useState<BatchChoice[] | null>(null);
  const [batch, setBatch] = useState<BatchChoice | null>(null);
  const tokenRef = useRef<string | null>(null);

  const reset = () => {
    setPhase('form');
    setQty('');
    setReason('');
    setFoldType(null);
    setReasonPickerOpen(false);
    setReasonFreeOpen(false);
    setReasonDraft('');
    setBatchChoices(null);
    setBatch(null);
    tokenRef.current = null;
  };

  // Kapanışta sıfırla — bir sonraki açılış önceki topun metrajıyla başlamasın.
  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  const createMutation = useMutation({
    mutationFn: (payload: TamburManualRollRequest) => tamburService.createManualRoll(payload),
    onSuccess: (res) => {
      tokenRef.current = null;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: res.data.alreadyAttached ? 'Top zaten eklenmişti' : 'Top elle eklendi',
        // Backend mesajı parti numarasını İÇERİR (tek açık parti sessizce
        // bağlandığında operatörün tek geri bildirimi budur) — ezme.
        text2: res.message ?? `Barkod: ${res.data.barcode ?? '—'}`,
        visibilityTime: 6000,
      });
      onCreated();
      onDismiss();
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor zaten bildirdi
      // BATCH_REQUIRED bir HATA DEĞİL, cevaplanmamış bir SORUDUR: iş emrinde
      // birden fazla açık parti var ve backend hiçbirini varsaymıyor. Toast
      // basıp operatörü çıkmaza sokmak yerine seçenekleri ekrana koyuyoruz.
      // Token DÜŞMEZ: bu dalda hiçbir top yaratılmadı (parti kontrolü FAZ 1'den
      // önce çalışır), dolayısıyla aynı mantıksal deneme sürüyor.
      const choices = readBatchChoices(err);
      if (choices) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setBatchChoices(choices);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Top eklenemedi', text2: err.message });
    },
  });

  const qtyNum = Number(qty);
  const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0;
  const reasonValid = reason.trim().length >= MIN_REASON;
  // Form artık YALNIZ metraj + sebep sorar (2026-08-04): ürün/renk iş emrinden
  // gelir, kalite Tambur kararında, en sonraki ölçümde belirlenir.
  const formValid = qtyValid && reasonValid && foldType !== null;

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
      foldType,
      // Parti YALNIZ operatör seçtiyse gider. Gönderilmezse backend çözer
      // (tek açık parti → sessizce bağla · birden fazla → BATCH_REQUIRED).
      ...(batch ? { batchId: batch.id } : {}),
    };
    // ⚠️ itemId / colorId / width / qualityGrade GÖNDERİLMEZ (2026-08-04 kararı):
    // ürün ve renk İŞ EMRİNDEN gelir ve operatör değiştiremez (backend guard'ı da
    // farklı değer gelirse ITEM_MISMATCH / COLOR_MISMATCH ile reddeder); kalite
    // Tambur kararında, en ise sonraki ölçümde belirlenir. Uç bu alanları hâlâ
    // KABUL EDER (API sözleşmesi bozulmadı) — form artık sormuyor.
    createMutation.mutate(payload);
  };

  const busy = createMutation.isPending;

  return (
    <>
      <AppModal
        visible={visible}
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

                {/* ── Zorunlu: kat ── */}
                <View>
                  <Text style={styles.label}>
                    Kat <Text style={styles.req}>*</Text>
                  </Text>
                  <View style={styles.foldRow}>
                    {(['2-KAT', '4-KAT'] as const).map((ft) => {
                      const active = foldType === ft;
                      return (
                        <TouchableRipple
                          key={ft}
                          borderless
                          disabled={busy}
                          onPress={() => setFoldType(ft)}
                          style={[styles.foldChip, active && styles.foldChipOn]}
                        >
                          <Text style={[styles.foldChipText, active && styles.foldChipTextOn]}>
                            {ft === '2-KAT' ? '2 Kat' : '4 Kat'}
                          </Text>
                        </TouchableRipple>
                      );
                    })}
                  </View>
                </View>

                {/* ── Zorunlu: sebep — hazır kategoriden TEK DOKUNUŞ ──
                    Serbest yazım kaldırılmadı, "Diğer"in altına alındı: eldivenli
                    operatör tablet klavyesiyle uğraşınca "aaa" gibi doldurmalar
                    üretiyordu ve o, boş bırakmaktan daha kötüdür (denetimde cevap
                    varmış gibi görünür). Aynı katalog "Manuel Mod" ile ORTAK. */}
                <View>
                  <Text style={styles.label}>
                    İşlem nedeni <Text style={styles.req}>*</Text>
                  </Text>
                  <Button
                    mode="contained-tonal"
                    icon={reasonValid ? 'check-circle-outline' : 'clipboard-text-outline'}
                    contentStyle={styles.pickBtnContent}
                    labelStyle={styles.pickBtnLabel}
                    disabled={busy}
                    onPress={() => setReasonPickerOpen(true)}
                  >
                    {reasonValid ? reason.trim() : 'Sebep seç'}
                  </Button>
                </View>

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
                  {/* Ürün/renk BİLEREK yazılmıyor: ikisi de iş emrinden gelir ve
                      operatör değiştiremez (2026-08-04 kararı) — ekranda göstermek
                      "seçebilirim" izlenimi verirdi. Kalite/en de sorulmuyor;
                      kalite Tambur kararında, en sonraki ölçümde belirlenir. */}
                  <SummaryRow label="Kat" value={foldType === '4-KAT' ? '4 Kat' : '2 Kat'} />
                  <SummaryRow label="Sebep" value={reason.trim()} />
                  {/* Parti YALNIZ operatör seçtiyse yazılır. Seçilmediğinde
                      "PARTİSİZ" YAZMA: backend tek açık partiyi sessizce
                      bağlayabilir ve o cümle YALAN olurdu. Gerçek cevap
                      başarıdaki toast'ta (backend mesajı parti no taşır). */}
                  {batch ? <SummaryRow label="Parti" value={batch.batchNumber} /> : null}
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

      {/* ── İŞLEM NEDENİ — hazır katalog + "Diğer" serbest metin ── */}
      <PickerModal
        visible={reasonPickerOpen}
        title="İşlem Nedeni"
        options={MANUAL_REASON_PRESETS.map((r) => ({ value: r, label: r }))}
        selectedValue={reason.trim() || null}
        numColumns={1}
        emptyText="Hazır sebep yok"
        leadingAction={{
          label: 'Diğer — kendim yazayım',
          sublabel: 'Listede olmayan bir durum',
          icon: 'pencil-outline',
          onPress: () => {
            // Kutu BOŞ açılır: seçili hazır sebep taşınmaz. "Diğer" demek
            // "listedekiler değil" demektir; hazır metni düzenletmek operatörü
            // önce silmeye zorlardı.
            setReasonDraft('');
            setReasonFreeOpen(true);
          },
        }}
        quickAddSlot={
          reasonFreeOpen ? (
            <View style={styles.reasonFreeBox}>
              <TextInput
                mode="outlined"
                dense
                autoFocus
                value={reasonDraft}
                onChangeText={setReasonDraft}
                placeholder="Sebebi yaz (en az 3 karakter)"
                maxLength={500}
                style={styles.input}
              />
              <View style={styles.reasonFreeActions}>
                <Button mode="outlined" onPress={() => setReasonFreeOpen(false)}>
                  Vazgeç
                </Button>
                <Button
                  mode="contained"
                  disabled={reasonDraft.trim().length < MIN_REASON}
                  onPress={() => {
                    setReason(reasonDraft.trim());
                    setReasonFreeOpen(false);
                    setReasonPickerOpen(false);
                  }}
                >
                  Kaydet
                </Button>
              </View>
            </View>
          ) : null
        }
        onSelect={(value) => {
          setReason(value);
          setReasonFreeOpen(false);
          setReasonPickerOpen(false);
        }}
        onDismiss={() => {
          setReasonFreeOpen(false);
          setReasonPickerOpen(false);
        }}
      />

      {/* ── PARTİ SEÇİMİ — yalnız backend sorduğunda ──
          Bu picker ÖNCEDEN açılmaz. "Açık parti" tanımı veriye dayanır (o
          partide hâlâ canlı top var mı) ve tek bilen backend'dir; mobil listeyi
          ayrıca çözerse iki kaynak doğar ve operatör ekranda gördüğü partiyi
          seçip reddedilir. Seçenekler her zaman reddeden tarafın ağzından
          gelir — bu yüzden akış "gönder → sorulursa cevapla" biçimindedir. */}
      <PickerModal
        visible={Boolean(batchChoices)}
        title="Hangi partiye eklensin?"
        options={(batchChoices ?? []).map((b) => ({
          value: b.id,
          label: b.batchNumber,
        }))}
        selectedValue={batch?.id ?? null}
        numColumns={1}
        emptyText="Açık parti yok"
        onSelect={(value) => {
          const chosen = (batchChoices ?? []).find((b) => b.id === value) ?? null;
          setBatchChoices(null);
          setBatch(chosen);
          // Seçimden sonra OTOMATİK göndermiyoruz: operatör onay ekranında
          // artık "Parti" satırını da görüp bilerek onaylasın (yıkıcı-onay
          // ilkesi — özet ile gönderilen içerik birebir aynı olmalı).
        }}
        onDismiss={() => {
          // Vazgeçti: soru cevapsız kaldı, gönderim YAPILMAZ. Token duruyor,
          // aynı mantıksal deneme sürüyor — tekrar "Evet, ekle" derse backend
          // aynı soruyu sorar.
          setBatchChoices(null);
        }}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────



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

  foldRow: { flexDirection: 'row', gap: spacing.sm },
  foldChip: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  foldChipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  foldChipText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  foldChipTextOn: { color: colors.textOnDark },

  pickBtnContent: { height: 52, justifyContent: 'flex-start' },
  pickBtnLabel: { fontSize: 15, fontWeight: '700' },

  reasonFreeBox: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  reasonFreeActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },

  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1 },
});
