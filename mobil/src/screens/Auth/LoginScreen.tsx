import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/auth.service';

// ──────────────── Sabitler ────────────────
const COLORS = {
  brandBg: '#0f172a',
  brandAccent: '#4f46e5',
  brandAccentLight: '#6366f1',
  brandText: '#f1f5f9',
  brandSubtext: '#94a3b8',
  formBg: '#f8fafc',
  white: '#ffffff',
  inputBg: '#ffffff',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  error: '#ef4444',
  errorBg: '#fef2f2',
  borderDefault: '#e2e8f0',
  borderFocus: '#4f46e5',
  btnPrimary: '#4f46e5',
};

const INPUT_THEME = {
  colors: {
    primary: '#4f46e5',
    onSurfaceVariant: '#475569',
    background: '#ffffff',
  },
  roundness: 10,
};

// ──────────────── InputField — bileşen dışında tanımlı ────────────────

interface InputFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  icon: string;
  secureTextEntry?: boolean;
  rightIcon?: string;
  onRightIconPress?: () => void;
  disabled?: boolean;
  onSubmitEditing?: () => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

function InputField({
  label,
  value,
  onChangeText,
  icon,
  secureTextEntry,
  rightIcon,
  onRightIconPress,
  disabled,
  onSubmitEditing,
  autoCapitalize = 'none',
}: InputFieldProps) {
  return (
    <TextInput
      label={label}
      value={value}
      onChangeText={onChangeText}
      mode="outlined"
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      secureTextEntry={secureTextEntry}
      style={styles.input}
      outlineStyle={styles.inputOutline}
      contentStyle={styles.inputContent}
      disabled={disabled}
      onSubmitEditing={onSubmitEditing}
      left={<TextInput.Icon icon={icon} color={COLORS.textSecondary} />}
      right={
        rightIcon ? (
          <TextInput.Icon
            icon={rightIcon}
            color={COLORS.textMuted}
            onPress={onRightIconPress}
          />
        ) : undefined
      }
      theme={INPUT_THEME}
    />
  );
}

// ──────────────── BrandPanel — bileşen dışında tanımlı ────────────────

const FEATURES = [
  { icon: '⚡', text: 'Gerçek zamanlı üretim takibi' },
  { icon: '🔗', text: 'Entegre tedarik zinciri' },
  { icon: '📊', text: 'Kapsamlı raporlama' },
] as const;

const GRID_H = Array.from({ length: 8 }, (_, i) => i);
const GRID_V = Array.from({ length: 6 }, (_, i) => i);

function BrandPanel() {
  return (
    <View style={styles.brandPanel}>
      {/* Dekoratif grid */}
      <View style={styles.brandGrid} pointerEvents="none">
        {GRID_H.map((i) => (
          <View key={`h-${i}`} style={[styles.gridLineH, { top: `${i * 14}%` as any }]} />
        ))}
        {GRID_V.map((i) => (
          <View key={`v-${i}`} style={[styles.gridLineV, { left: `${i * 20}%` as any }]} />
        ))}
      </View>

      <View style={styles.brandContent}>
        {/* Logo */}
        <View style={styles.logoOuter}>
          <View style={styles.logoInner}>
            <Text style={styles.logoLetter}>T</Text>
          </View>
        </View>

        {/* Başlık */}
        <View style={styles.brandTextGroup}>
          <Text style={styles.brandName}>TeksERP</Text>
          <View style={styles.brandDivider} />
          <Text style={styles.brandTagline}>Tekstil Üretim Yönetim Sistemi</Text>
        </View>

        {/* Özellikler */}
        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.text} style={styles.featureItem}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* Alt bilgi */}
        <View style={styles.brandFooter}>
          <View style={styles.brandFooterBadge}>
            <Text style={styles.brandFooterBadgeText}>v2.1</Text>
          </View>
          <Text style={styles.brandFooterText}>© 2025 TeksERP. Tüm hakları saklıdır.</Text>
        </View>
      </View>
    </View>
  );
}

// ──────────────── Ana Bileşen ────────────────

export default function LoginScreen() {
  const setAuth = useAuthStore((s) => s.setAuth);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isWeb = Platform.OS === 'web';

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Kullanıcı adı ve şifre giriniz.');
      Toast.show({
        type: 'error',
        text1: 'Eksik Bilgi',
        text2: 'Lütfen kullanıcı adı ve şifrenizi girin.',
      });
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await authService.login({ username: username.trim(), password });
      await setAuth(res.data.user, res.data.token);
      Toast.show({
        type: 'success',
        text1: 'Başarılı',
        text2: 'Hoş geldiniz!',
      });
    } catch (e: any) {
      const msg = e.message || 'Kullanıcı adı veya şifre hatalı.';
      setError(msg);
      Toast.show({
        type: 'error',
        text1: 'Giriş Başarısız',
        text2: msg,
      });
    } finally {
      setLoading(false);
    }
  };

  // Form JSX — bileşen içinde ama alt bileşen OLARAK TANIMLANMADI,
  // doğrudan render içinde yer alıyor (re-mount sorunu olmaz)
  const formContent = (
    <KeyboardAvoidingView
      style={styles.formPanel}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      enabled={!isWeb}
    >
      <ScrollView
        contentContainerStyle={styles.formScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.formCard}>
          {/* Başlık */}
          <View style={styles.formHeader}>
            <View style={styles.formHeaderIcon}>
              <Text style={styles.formHeaderIconText}>🔐</Text>
            </View>
            <Text style={styles.formTitle}>Sisteme Giriş</Text>
            <Text style={styles.formSubtitle}>
              Yetkili erişim için kimlik bilgilerinizi girin
            </Text>
          </View>

          {/* Hata */}
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorIcon}>⚠</Text>
              <Text style={styles.errorMessage}>{error}</Text>
            </View>
          ) : null}

          {/* Alanlar */}
          <View style={styles.formFields}>
            <View style={styles.fieldWrapper}>
              <Text style={styles.fieldLabel}>Kullanıcı Adı</Text>
              <InputField
                label="Kullanıcı adınızı girin"
                value={username}
                onChangeText={setUsername}
                icon="account-outline"
                disabled={loading}
              />
            </View>

            <View style={styles.fieldWrapper}>
              <Text style={styles.fieldLabel}>Şifre</Text>
              <InputField
                label="Şifrenizi girin"
                value={password}
                onChangeText={setPassword}
                icon="lock-outline"
                secureTextEntry={!showPassword}
                rightIcon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                onRightIconPress={() => setShowPassword((p) => !p)}
                disabled={loading}
                onSubmitEditing={handleLogin}
              />
            </View>
          </View>

          {/* Buton */}
          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={styles.loginBtnText}>
              {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </Text>
            {!loading && <Text style={styles.loginBtnArrow}>→</Text>}
          </TouchableOpacity>

          {/* Alt Bilgi */}
          <View style={styles.formFooter}>
            <Text style={styles.formFooterText}>
              Erişim sorunlarınız için sistem yöneticisiyle iletişime geçin.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Web görünümü ──
  if (isWeb) {
    return (
      <View style={styles.root}>
        <BrandPanel />
        {formContent}
      </View>
    );
  }

  // ── Mobil görünümü ──
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={[styles.root, styles.rootMobile]}>
        {/* Kompakt marka başlığı */}
        <View style={styles.mobileBrand}>
          <View style={styles.mobileLogoRow}>
            <View style={styles.mobileLogoBox}>
              <Text style={styles.logoLetter}>T</Text>
            </View>
            <View>
              <Text style={styles.mobileBrandName}>TeksERP</Text>
              <Text style={styles.mobileBrandSub}>Üretim Yönetim Sistemi</Text>
            </View>
          </View>
        </View>

        {/* Form */}
        <View style={styles.mobileFormArea}>
          {formContent}
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

// ──────────────── Stiller ────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.brandBg,
  },
  rootMobile: {
    flexDirection: 'column',
  },

  // Marka Paneli
  brandPanel: {
    flex: 2,
    backgroundColor: COLORS.brandBg,
    overflow: 'hidden',
    position: 'relative',
  },
  brandGrid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.06,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.brandText,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: COLORS.brandText,
  },
  brandContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: 56,
    paddingVertical: 48,
    gap: 36,
  },
  logoOuter: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: 'rgba(79, 70, 229, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(79, 70, 229, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoInner: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: COLORS.brandAccent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoLetter: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  brandTextGroup: {
    gap: 12,
  },
  brandName: {
    color: COLORS.brandText,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  brandDivider: {
    width: 48,
    height: 3,
    backgroundColor: COLORS.brandAccent,
    borderRadius: 2,
  },
  brandTagline: {
    color: COLORS.brandSubtext,
    fontSize: 16,
    lineHeight: 24,
  },
  featureList: {
    gap: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureIcon: {
    fontSize: 18,
    width: 32,
    textAlign: 'center',
  },
  featureText: {
    color: COLORS.brandSubtext,
    fontSize: 14,
  },
  brandFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    position: 'absolute' as any,
    bottom: 32,
    left: 56,
  },
  brandFooterBadge: {
    backgroundColor: 'rgba(79,70,229,0.2)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.3)',
  },
  brandFooterBadgeText: {
    color: COLORS.brandAccentLight,
    fontSize: 11,
    fontWeight: '600',
  },
  brandFooterText: {
    color: COLORS.brandSubtext,
    fontSize: 12,
  },

  // Form Paneli
  formPanel: {
    flex: 3,
    backgroundColor: COLORS.formBg,
  },
  formScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 48,
    paddingVertical: 48,
  },
  formCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 40,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  formHeader: {
    alignItems: 'flex-start',
    marginBottom: 28,
    gap: 8,
  },
  formHeaderIcon: {
    width: 44,
    height: 44,
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  formHeaderIconText: {
    fontSize: 22,
  },
  formTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.3,
  },
  formSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.errorBg,
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorIcon: {
    fontSize: 16,
    color: COLORS.error,
  },
  errorMessage: {
    color: COLORS.error,
    fontSize: 14,
    flex: 1,
    fontWeight: '500',
  },
  formFields: {
    gap: 4,
    marginBottom: 24,
  },
  fieldWrapper: {
    gap: 4,
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: COLORS.inputBg,
    fontSize: 15,
  },
  inputOutline: {
    borderColor: COLORS.borderDefault,
    borderRadius: 10,
  },
  inputContent: {
    paddingVertical: 4,
  },
  loginBtn: {
    backgroundColor: COLORS.btnPrimary,
    borderRadius: 12,
    height: 54,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    shadowColor: COLORS.brandAccent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  loginBtnDisabled: {
    opacity: 0.7,
  },
  loginBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  loginBtnArrow: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 18,
    fontWeight: '600',
  },
  formFooter: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderDefault,
    alignItems: 'center',
  },
  formFooterText: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Mobil
  mobileBrand: {
    backgroundColor: COLORS.brandBg,
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 32,
  },
  mobileLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  mobileLogoBox: {
    width: 50,
    height: 50,
    borderRadius: 13,
    backgroundColor: COLORS.brandAccent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobileBrandName: {
    color: COLORS.brandText,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  mobileBrandSub: {
    color: COLORS.brandSubtext,
    fontSize: 12,
  },
  mobileFormArea: {
    flex: 1,
    backgroundColor: COLORS.formBg,
  },
});
