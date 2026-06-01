import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, BackHandler } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  Text,
  TextInput,
  Button,
  Icon,
} from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDeviceStore } from '../../store/deviceStore';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermission';
import { deviceService } from '../../services/device.service';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { RootStackParamList } from '../../navigation/types';

// SettingsScreen ile aynı koyu palet — tutarlı "cihaz/yönetim" hissi.
const COLORS = {
  bg: '#0f172a',
  bgDarker: '#0a1120',
  bgSoft: '#1e293b',
  accent: '#4f46e5',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  success: '#22c55e',
  successBg: '#052e1a',
  error: '#ef4444',
  errorBg: '#3f1d1f',
};

export default function DevicePairingScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const deviceId = useDeviceStore((s) => s.deviceId);
  const paired = useDeviceStore((s) => s.paired);
  const setPaired = useDeviceStore((s) => s.setPaired);
  const clearPairing = useDeviceStore((s) => s.clearPairing);
  const { hasAnyMobileScreen } = usePermissions();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  // Eşleşme durumu bu ekranda değiştiyse (sıfırla/eşleştir) geri tuşu basit
  // goBack yerine RESET kullanmalı — çünkü paired değişimi RootNavigator'ın
  // conditional ekranını (Login/Pairing) stack'ten düşürüp geri dönüşü bozuyor.
  const [changed, setChanged] = useState(false);

  // Pushed Settings/DevicePairing'i temizleyip o anki gerçek duruma göre doğru
  // köke dön (RootNavigator mantığının aynısı). Kısa gecikme: state değişiminin
  // RootNavigator'da commit olup hedef ekranın tanımlı hale gelmesi için (aksi
  // halde reset "no screen named X" ile düşer).
  const exitToRoot = useCallback(() => {
    const p = useDeviceStore.getState().paired;
    const u = useAuthStore.getState().user;
    const target: keyof RootStackParamList = !p
      ? 'Pairing'
      : !u
        ? 'Login'
        : hasAnyMobileScreen
          ? 'Main'
          : 'NoAccess';
    setTimeout(() => {
      navigation.reset({ index: 0, routes: [{ name: target }] });
    }, 120);
  }, [navigation, hasAnyMobileScreen]);

  const handleBack = () => {
    if (changed) {
      exitToRoot();
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  // Android donanım/gesture geri tuşu: eşleşme değiştiyse default goBack (bozuk
  // stack) yerine doğru köke reset et.
  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (changed) {
          exitToRoot();
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [changed, exitToRoot]),
  );

  const submit = async () => {
    if (!deviceId) {
      setError('Cihaz kimliği okunamadı');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError('Kod 6 haneli olmalı');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await deviceService.pair({ deviceId, code });
      const m = res.data.machine;
      await setPaired({
        id: m.id,
        code: m.code,
        name: m.name,
        stationId: m.station.id,
        stationName: m.station.name,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Eşleşme başarılı',
        text2: `${m.code} — ${m.name}`,
      });
      setCode('');
      setChanged(true);
      exitToRoot();
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = e instanceof Error ? e.message : 'Eşleştirme başarısız';
      setError(msg);
      setCode('');
      Toast.show({ type: 'error', text1: 'Hata', text2: msg });
    } finally {
      setLoading(false);
    }
  };

  const doReset = async () => {
    await clearPairing();
    setChanged(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Toast.show({
      type: 'info',
      text1: 'Eşleşme sıfırlandı',
      text2: 'Yeni kod girerek tekrar eşleştirin',
    });
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.root}>
      <Appbar.Header style={styles.appbar} dark statusBarHeight={insets.top}>
        <Appbar.BackAction onPress={handleBack} color={COLORS.text} />
        <Appbar.Content title="Cihaz Eşleştirme" titleStyle={styles.appbarTitle} />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Mevcut eşleşme durumu ── */}
        <View style={styles.card}>
          <View style={styles.headRow}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: paired ? COLORS.successBg : COLORS.bgDarker },
              ]}
            >
              <Icon
                source={paired ? 'check-decagram' : 'link-off'}
                size={28}
                color={paired ? COLORS.success : COLORS.subtext}
              />
            </View>
            <View style={styles.headText}>
              <Text style={styles.title}>Eşleşme Durumu</Text>
              {paired ? (
                <Text style={styles.subtitle}>
                  {paired.code} — {paired.name}
                  {paired.stationName ? ` · ${paired.stationName}` : ''}
                </Text>
              ) : (
                <Text style={styles.subtitle}>
                  Bu cihaz bir makineye eşli değil. Aşağıdan kod girerek eşleştir.
                </Text>
              )}
            </View>
          </View>

          {paired && (
            <Button
              mode="outlined"
              icon="link-variant-off"
              onPress={() => setResetConfirm(true)}
              style={styles.resetBtn}
              contentStyle={styles.btnContent}
              labelStyle={styles.resetBtnLabel}
              textColor={COLORS.error}
            >
              Eşleşmeyi Sıfırla
            </Button>
          )}
        </View>

        {/* ── Eşleştirme kodu girişi ── */}
        <View style={styles.card}>
          <View style={styles.headRow}>
            <View style={styles.iconBox}>
              <Icon source="key-variant" size={28} color={COLORS.accentLight} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.title}>
                {paired ? 'Yeniden Eşleştir' : 'Eşleştirme Kodu'}
              </Text>
              <Text style={styles.subtitle}>
                Yöneticiden alınan 6 haneli kodu gir.
              </Text>
            </View>
          </View>

          <TextInput
            mode="outlined"
            value={code}
            onChangeText={(v) => {
              setCode(v.replace(/\D/g, '').slice(0, 6));
              if (error) setError('');
            }}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            autoFocus={!paired}
            style={styles.codeInput}
            outlineColor={COLORS.border}
            activeOutlineColor={COLORS.accentLight}
            textColor={COLORS.text}
            theme={{
              colors: {
                background: COLORS.bgDarker,
                onSurfaceVariant: COLORS.subtext,
              },
            }}
            left={<TextInput.Icon icon="pound" color={COLORS.subtext} />}
          />

          {error ? (
            <View style={styles.errorRow}>
              <Icon source="alert-circle" size={18} color={COLORS.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button
            mode="contained"
            icon="link-variant"
            onPress={submit}
            loading={loading}
            disabled={code.length !== 6 || loading}
            style={styles.pairBtn}
            contentStyle={styles.btnContent}
            labelStyle={styles.pairBtnLabel}
            buttonColor={COLORS.accent}
          >
            Cihazı Eşleştir
          </Button>
        </View>

        {/* ── Cihaz kimliği ── */}
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>CİHAZ KİMLİĞİ</Text>
          <Text style={styles.infoValue} selectable>
            {deviceId ?? '—'}
          </Text>
        </View>
      </ScrollView>

      <ConfirmDialog
        kind="destructive"
        visible={resetConfirm}
        title="Eşleşmeyi sıfırla?"
        description={
          'Cihazın makine eşleşmesi kaldırılacak. Tekrar kullanmak için ' +
          'yöneticiden yeni 6 haneli kod alıp girmen gerekir. Eşleşme olmadan ' +
          'operatör girişi (kullanıcı listesi / login) çalışmaz.'
        }
        confirmLabel="Sıfırla"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          void doReset();
          setResetConfirm(false);
        }}
        onDismiss={() => setResetConfirm(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  appbar: { backgroundColor: COLORS.bgDarker, elevation: 0 },
  appbarTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },

  scroll: { padding: 20, gap: 16, paddingBottom: 32 },

  card: {
    backgroundColor: COLORS.bgSoft,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headRow: { flexDirection: 'row', gap: 14, marginBottom: 16 },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 13,
    backgroundColor: COLORS.bgDarker,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headText: { flex: 1, justifyContent: 'center' },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: COLORS.subtext, fontSize: 13, marginTop: 4, lineHeight: 18 },

  codeInput: {
    backgroundColor: COLORS.bgDarker,
    fontSize: 22,
    letterSpacing: 8,
    fontWeight: '700',
  },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    backgroundColor: COLORS.errorBg,
    borderColor: '#7f1d1d',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  errorText: { color: COLORS.error, fontSize: 13, fontWeight: '600', flex: 1 },

  pairBtn: { borderRadius: 10, marginTop: 18 },
  pairBtnLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnContent: { height: 52 },

  resetBtn: {
    borderRadius: 10,
    borderColor: '#7f1d1d',
    borderWidth: 1,
  },
  resetBtnLabel: { fontSize: 14, fontWeight: '700' },

  infoCard: {
    backgroundColor: COLORS.bgSoft,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoLabel: {
    color: COLORS.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  infoValue: {
    color: COLORS.text,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
