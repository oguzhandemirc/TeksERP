// =============================================================================
// Güncelleme kartının AKSİYON bloğu — "denetle düğmesi hiçbir durumda düşmez"
// =============================================================================
// ⚠️ ÖLÇÜLEN HATA (2026-09-04): eski kurgu `isUpdatePending ? <A/> : <B/>`
// biçimindeydi; yani denetleme yeni bir paket indirdiği ANDA "Güncellemeleri
// denetle" düğmesi ağaçtan DÜŞÜYOR ve yerine "Şimdi yenile" geliyordu. Operatör
// tarifi birebir buydu: "denetle deyince buton kayboluyor." İkinci sebep de
// aynı yerdeydi ve tek başına yeterliydi: düğme `mode="outlined"` + `disabled`
// olduğunda Paper renk proplarını yok sayıp MD3 AÇIK temanın silik gri
// tonlarına düşüyordu (bkz. `settingsUi.tsx` içindeki uyarı) — koyu kartın
// üstünde bu, görünmezlik demek.
//
// KURAL: durum değişimi düğmeyi KALDIRMAZ, yalnız yanına/üstüne EKLER. Bu dosya
// bilerek SAF bir sunum bileşenidir (hiç `expo-updates` çağırmaz) — tam da bu
// invariantı ölçebilmek için: `UpdateActions.test.tsx`.
// =============================================================================

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';

import type { OtaKontrolSonuc } from '../../../services/appUpdate.service';
import { SETTINGS_COLORS as COLORS, SettingsActionButton, settingsStyles } from './settingsUi';

export interface UpdateActionsProps {
  /** Uzaktan güncelleme bu kurulumda açık mı (dev derlemede kapalı). */
  etkin: boolean;
  /** Elle denetleme koşuyor mu (asgari süreli meşguliyet). */
  denetleniyor: boolean;
  /** `expo-updates` paket indiriyor mu. */
  indiriliyor: boolean;
  /** İnmiş paket uygulanmayı bekliyor mu. */
  uygulamaBekliyor: boolean;
  /** Sunucuda yeni paket görüldü mü (henüz inmedi). */
  yeniVar: boolean;
  /** Son elle denetlemenin sonucu. */
  sonuc: OtaKontrolSonuc | null;
  /** Son denetlemenin saati (`HH:MM`) — "bir şey oldu mu?" sorusunun cevabı. */
  sonDenetlemeSaati: string | null;
  /** Kuyrukta bekleyen istasyon yazımı sayısı. */
  bekleyenYazim: number;
  yenileniyor: boolean;
  onDenetle: () => void;
  onYenile: () => void;
}

export function UpdateActions({
  etkin,
  denetleniyor,
  indiriliyor,
  uygulamaBekliyor,
  yeniVar,
  sonuc,
  sonDenetlemeSaati,
  bekleyenYazim,
  yenileniyor,
  onDenetle,
  onYenile,
}: UpdateActionsProps) {
  const mesgul = denetleniyor || indiriliyor;

  return (
    <View>
      {/* ---------------------------------------------------------- Durum */}
      {uygulamaBekliyor ? (
        <>
          <DurumSatiri
            tur="iyi"
            ikon="package-down"
            metin="Yeni sürüm indirildi, uygulanmayı bekliyor."
          />
          {bekleyenYazim > 0 && (
            <Text style={settingsStyles.hint}>
              {bekleyenYazim} kayıt henüz sunucuya gönderilmedi — gönderilir gönderilmez
              uygulanacak.
            </Text>
          )}
        </>
      ) : (
        <>
          {sonuc?.durum === 'guncel' && (
            <DurumSatiri tur="iyi" ikon="check-circle" metin="Güncel — yeni sürüm yok." />
          )}
          {sonuc?.durum === 'indirildi' && (
            <DurumSatiri tur="iyi" ikon="package-down" metin="Yeni sürüm indirildi." />
          )}
          {sonuc?.durum === 'kapali' && (
            <DurumSatiri
              tur="notr"
              ikon="information"
              metin="Bu kurulumda uzaktan güncelleme kapalı."
            />
          )}
          {sonuc?.durum === 'hata' && (
            <DurumSatiri
              tur="kotu"
              ikon="wifi-off"
              metin={`Güncelleme sunucusuna ulaşılamadı. Tablet internete bağlı mı? (${sonuc.mesaj})`}
            />
          )}
          {yeniVar && !indiriliyor && !sonuc && (
            <DurumSatiri tur="iyi" ikon="cloud-download" metin="Yeni sürüm var." />
          )}
        </>
      )}

      {/* ------------------------------------------------------- Aksiyonlar */}
      {/* ⚠️ SIRA: hazır olan iş üstte. "Şimdi yenile" EK bir düğmedir — aşağıdaki
          denetle düğmesinin YERİNE GEÇMEZ. */}
      {uygulamaBekliyor && (
        <SettingsActionButton
          testID="ota-yenile"
          tone="success"
          icon="restart"
          label="Şimdi yenile"
          busyLabel="Yenileniyor…"
          busy={yenileniyor}
          onPress={onYenile}
          style={styles.dugme}
        />
      )}

      <SettingsActionButton
        testID="ota-denetle"
        tone={uygulamaBekliyor ? 'neutral' : 'primary'}
        icon="cloud-sync"
        label="Güncellemeleri denetle"
        busyLabel={indiriliyor ? 'İndiriliyor…' : 'Denetleniyor…'}
        busy={mesgul}
        disabled={!etkin}
        onPress={onDenetle}
        style={styles.dugme}
      />

      {!etkin && (
        <Text style={settingsStyles.hint}>
          Bu bir geliştirme kurulumu — denetleme yapılamaz.
        </Text>
      )}
      {etkin && sonDenetlemeSaati && !mesgul && (
        <Text style={settingsStyles.hint}>Son denetleme: {sonDenetlemeSaati}</Text>
      )}
    </View>
  );
}

function DurumSatiri({
  tur,
  ikon,
  metin,
}: {
  tur: 'iyi' | 'kotu' | 'notr';
  ikon: string;
  metin: string;
}) {
  const renk = tur === 'iyi' ? COLORS.success : tur === 'kotu' ? COLORS.error : COLORS.subtext;
  const kutu =
    tur === 'iyi' ? styles.durumIyi : tur === 'kotu' ? styles.durumKotu : styles.durumNotr;
  return (
    <View style={[styles.durumSatir, kutu]}>
      <Icon source={ikon} size={20} color={renk} />
      <Text style={[styles.durumMetin, { color: renk }]}>{metin}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  durumSatir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
  },
  durumMetin: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  durumIyi: { backgroundColor: COLORS.successBg, borderColor: '#166534' },
  durumKotu: { backgroundColor: COLORS.errorBg, borderColor: '#7f1d1d' },
  durumNotr: { backgroundColor: COLORS.bgDarker, borderColor: COLORS.border },
  dugme: { marginTop: 14 },
});
