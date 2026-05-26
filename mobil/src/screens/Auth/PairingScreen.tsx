import React, { useState } from 'react';
import { View, StyleSheet, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, Button, TouchableRipple, Icon, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useDeviceStore } from '../../store/deviceStore';
import { deviceService } from '../../services/device.service';
import { useDeviceType, useIsPortrait } from '../../hooks/useDeviceType';
import type { RootStackParamList } from '../../navigation/types';

const COLORS = {
  brandBg: '#0f172a',
  brandAccent: '#4f46e5',
  brandAccentLight: '#6366f1',
  cardBg: '#ffffff',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  error: '#ef4444',
  errorBg: '#fef2f2',
  borderDefault: '#e2e8f0',
  numpadBg: '#0f172a',
  numpadBorder: '#334155',
  backspaceBg: '#3f1d1f',
  backspaceBorder: '#7f1d1d',
  backspaceIcon: '#fecaca',
  pinEmpty: '#cbd5e1',
};

const CODE_LENGTH = 6;

type Cell = { key: string; type: 'digit' | 'backspace' | 'empty' };
const NUMPAD_ROWS: Cell[][] = [
  [{ key: '1', type: 'digit' }, { key: '2', type: 'digit' }, { key: '3', type: 'digit' }],
  [{ key: '4', type: 'digit' }, { key: '5', type: 'digit' }, { key: '6', type: 'digit' }],
  [{ key: '7', type: 'digit' }, { key: '8', type: 'digit' }, { key: '9', type: 'digit' }],
  [{ key: '_', type: 'empty' }, { key: '0', type: 'digit' }, { key: '⌫', type: 'backspace' }],
];

export default function PairingScreen() {
  const deviceId = useDeviceStore((s) => s.deviceId);
  const setPaired = useDeviceStore((s) => s.setPaired);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const device = useDeviceType();
  const portrait = useIsPortrait();
  const isCompact = device === 'phone' || portrait;

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!deviceId) return;
    if (!/^\d{6}$/.test(code)) {
      setError('Kod 6 haneli olmalı');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await deviceService.pair({ deviceId, code });
      const m = res.data.machine;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await setPaired({
        id: m.id,
        code: m.code,
        name: m.name,
        stationId: m.station.id,
        stationName: m.station.name,
      });
      Toast.show({
        type: 'success',
        text1: 'Eşleşme başarılı',
        text2: `${m.code} — ${m.name}`,
      });
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

  const handleKey = (cell: Cell) => {
    if (loading || cell.type === 'empty') return;
    if (cell.type === 'backspace') {
      if (code.length === 0) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCode((c) => c.slice(0, -1));
      setError('');
      return;
    }
    if (code.length >= CODE_LENGTH) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCode((c) => (c + cell.key).slice(0, CODE_LENGTH));
    setError('');
  };

  const canSubmit = code.length === CODE_LENGTH && !loading;

  const infoSection = (
    <View style={[styles.leftPanel, isCompact && styles.leftPanelCompact]}>
      <View style={styles.iconBox}>
        <Text style={styles.iconEmoji}>📱</Text>
      </View>
      <Text style={styles.title}>Cihaz Eşleştir</Text>
      <Text style={styles.subtitle}>
        Bu cihaz henüz bir makineye bağlı değil. Yöneticiden 6 haneli
        eşleştirme kodu isteyin ve tuş takımından girin.
      </Text>

      <Text style={styles.sectionLabel}>EŞLEŞTİRME KODU</Text>
      <View style={styles.pinRow}>
        {Array.from({ length: CODE_LENGTH }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.pinDot,
              i < code.length && styles.pinDotFilled,
              i === code.length && !loading && styles.pinDotActive,
              !!error && styles.pinDotError,
            ]}
          >
            {i < code.length && <Text style={styles.pinDigit}>{code[i]}</Text>}
          </View>
        ))}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Icon source="alert-circle" size={18} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Button
        mode="contained"
        onPress={submit}
        loading={loading}
        disabled={!canSubmit}
        style={styles.btn}
        contentStyle={styles.btnContent}
        labelStyle={styles.btnLabel}
      >
        Cihazı Eşleştir
      </Button>

      <View style={styles.footer}>
        <Text style={styles.footerLabel}>Cihaz Kimliği</Text>
        <Text style={styles.footerCode}>{deviceId ?? '—'}</Text>
      </View>
    </View>
  );

  const numpadSection = (
    <View style={[styles.rightPanel, isCompact && styles.rightPanelCompact]}>
      <View style={styles.numpad}>
        {NUMPAD_ROWS.map((row, ri) => (
          <View key={ri} style={styles.numpadRow}>
            {row.map((cell, ci) => {
              if (cell.type === 'empty') {
                return <View key={ci} style={styles.numpadKeyPlaceholder} />;
              }
              const isBack = cell.type === 'backspace';
              const disabled = loading || (isBack && code.length === 0);
              return (
                <TouchableRipple
                  key={ci}
                  onPress={() => handleKey(cell)}
                  disabled={disabled}
                  rippleColor="rgba(99,102,241,0.3)"
                  style={[
                    styles.numpadKey,
                    isBack && styles.numpadKeyBackspace,
                    disabled && styles.numpadKeyDisabled,
                  ]}
                >
                  <View style={styles.numpadKeyContent}>
                    {isBack ? (
                      <Icon
                        source="backspace-outline"
                        size={32}
                        color={disabled ? '#7f1d1d' : COLORS.backspaceIcon}
                      />
                    ) : (
                      <Text
                        style={[
                          styles.numpadKeyText,
                          disabled && styles.numpadKeyTextDisabled,
                        ]}
                      >
                        {cell.key}
                      </Text>
                    )}
                  </View>
                </TouchableRipple>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );

  const cardInner = isCompact ? (
    <>
      {infoSection}
      {numpadSection}
    </>
  ) : (
    <>
      {infoSection}
      {numpadSection}
    </>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <View style={styles.topBar}>
        <IconButton
          icon="cog"
          iconColor="#cbd5e1"
          size={26}
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Sunucu ayarları"
        />
      </View>
      {isCompact ? (
        <ScrollView
          contentContainerStyle={styles.centerCompact}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.card, styles.cardCompact]}>{cardInner}</View>
        </ScrollView>
      ) : (
        <View style={styles.center}>
          <View style={styles.card}>{cardInner}</View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.brandBg },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  centerCompact: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    width: '100%',
    maxWidth: 880,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  cardCompact: { flexDirection: 'column', maxWidth: 480 },

  leftPanel: { flex: 1, padding: 28, justifyContent: 'center' },
  leftPanelCompact: { flex: 0, padding: 22 },
  iconBox: {
    width: 56,
    height: 56,
    backgroundColor: '#eef2ff',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  iconEmoji: { fontSize: 28 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18, marginBottom: 18 },

  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  pinRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  pinDot: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.pinEmpty,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinDotFilled: { backgroundColor: '#eef2ff', borderColor: COLORS.brandAccent },
  pinDotActive: { borderColor: COLORS.brandAccentLight },
  pinDotError: { borderColor: COLORS.error },
  pinDigit: { fontSize: 22, fontWeight: '700', color: COLORS.brandAccent },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.errorBg,
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  errorText: { color: COLORS.error, fontSize: 13, fontWeight: '500', flex: 1 },

  btn: { borderRadius: 12, backgroundColor: COLORS.brandAccent },
  btnContent: { height: 52 },
  btnLabel: { fontSize: 16, fontWeight: '700', color: '#ffffff' },

  footer: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderDefault,
  },
  footerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  footerCode: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  rightPanel: {
    flex: 1,
    padding: 20,
    backgroundColor: COLORS.numpadBg,
    justifyContent: 'center',
  },
  rightPanelCompact: { flex: 0, padding: 18 },
  numpad: { gap: 10, alignSelf: 'center', width: '100%', maxWidth: 360 },
  numpadRow: { flexDirection: 'row', gap: 10 },
  numpadKey: {
    flex: 1,
    height: 68,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.numpadBorder,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
  },
  numpadKeyBackspace: {
    backgroundColor: COLORS.backspaceBg,
    borderColor: COLORS.backspaceBorder,
  },
  numpadKeyDisabled: { opacity: 0.4 },
  numpadKeyPlaceholder: { flex: 1, height: 68 },
  numpadKeyContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  numpadKeyText: { color: '#f1f5f9', fontSize: 30, fontWeight: '700' },
  numpadKeyTextDisabled: { color: '#475569' },
});
