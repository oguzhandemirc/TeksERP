import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Image, TextInput } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TouchableRipple, ActivityIndicator, Icon, IconButton } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../store/authStore';
import { authService, type LoginMethod } from '../../services/auth.service';
import { BarcodeScannerModal } from '../../components/BarcodeScannerModal';
import PickerModal, { type PickerOption } from '../../components/PickerModal';
import { useDeviceType, useIsPortrait } from '../../hooks/useDeviceType';
import type { MobileUser } from '../../types/auth';
import type { RootStackParamList } from '../../navigation/types';

const COLORS = {
  bg: '#0f172a',
  bgSoft: '#1e293b',
  bgDarker: '#0a1120',
  accent: '#4f46e5',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  borderDark: '#1e293b',
  error: '#ef4444',
  pinEmpty: '#334155',
  backspaceBg: '#3f1d1f',
  backspaceBorder: '#7f1d1d',
  backspaceIcon: '#fecaca',
};

const PIN_LENGTH = 6;

/** Giriş yöntemi etiket/ikon/renkleri — yöntem değiştirici butonları. Renkler
 *  BİLEREK birbirinden uzak tonlar: fabrikada uzaktan/eldivenle tek bakışta
 *  ayırt edilebilsin. Hiçbir ekranda çakışma yok: bir yöntemin butonu kendi
 *  ekranında görünmez → kart ekranı turuncu+teal, PIN ekranı turuncu+mavi,
 *  liste ekranı teal+mavi görür; indigo ekranların ana vurgu rengi olarak
 *  serbest kalır ("Kartı Okut" butonu vb. ile karışmaz). */
const METHOD_META: Record<LoginMethod, { label: string; icon: string; color: string }> = {
  list: { label: 'Kullanıcı + Şifre', icon: 'account-key', color: '#ea580c' },
  pin: { label: 'Hızlı PIN', icon: 'dialpad', color: '#0d9488' },
  card: { label: 'QR Personel Kartı', icon: 'qrcode-scan', color: '#2563eb' },
};

type Cell = { key: string; type: 'digit' | 'backspace' | 'empty' };
const NUMPAD_ROWS: Cell[][] = [
  [{ key: '1', type: 'digit' }, { key: '2', type: 'digit' }, { key: '3', type: 'digit' }],
  [{ key: '4', type: 'digit' }, { key: '5', type: 'digit' }, { key: '6', type: 'digit' }],
  [{ key: '7', type: 'digit' }, { key: '8', type: 'digit' }, { key: '9', type: 'digit' }],
  [{ key: '_', type: 'empty' }, { key: '0', type: 'digit' }, { key: '⌫', type: 'backspace' }],
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function LoginScreen() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const device = useDeviceType();
  const portrait = useIsPortrait();
  const isCompact = device === 'phone' || portrait;
  const insets = useSafeAreaInsets();

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Giriş yöntemleri (auth.loginMethods ayarı — public uç): ekran ÖNCELİKLİ
  // yöntemle açılır; diğer etkin yöntemler "Diğer giriş yöntemlerini dene"
  // butonuyla seçenek olarak çıkar. list=kullanıcı+şifre, pin=salt hızlı-PIN
  // (kullanıcı seçme yok — PIN benzersiz), card=QR personel kartı.
  // SAHA BUG'ı: 5 dk staleTime + ekran hep açık → panelden yöntem değişikliği
  // tablete çok geç yansıyordu. Login ekranı zaten boşta bekleyen bir ekran:
  // açıkken 10 sn'de bir tazele (public uç, minik yanıt; ekran kapanınca durur).
  const methodsQ = useQuery({
    queryKey: ['auth', 'login-methods'],
    queryFn: authService.getLoginMethods,
    refetchInterval: 10_000,
    refetchOnMount: 'always',
  });
  const enabledMethods = methodsQ.data?.enabled ?? ['list'];
  const [pickedMethod, setPickedMethod] = useState<LoginMethod | null>(null);
  const [methodPickerOpen, setMethodPickerOpen] = useState(false);
  const [cardScannerOpen, setCardScannerOpen] = useState(false);
  // Aktif görünüm: kullanıcı seçtiyse o; yoksa ayarın öncelikli yöntemi.
  const activeMethod: LoginMethod =
    pickedMethod && enabledMethods.includes(pickedMethod)
      ? pickedMethod
      : (methodsQ.data?.primary ?? 'list');

  const usersQuery = useQuery({
    queryKey: ['auth', 'mobile-users'],
    queryFn: () => authService.getMobileUsers(),
    staleTime: 5 * 60 * 1000,
    // Kullanıcı listesi yalnız "liste+şifre" görünümünde gerekir (salt-PIN/kart
    // görünümlerinde kimse listelenmez — gereksiz istek atma).
    enabled: enabledMethods.includes('list'),
  });

  const users = usersQuery.data?.data ?? [];
  const selectedUser = useMemo<MobileUser | null>(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  useEffect(() => {
    if (!selectedUserId && users.length === 1) setSelectedUserId(users[0].id);
  }, [users, selectedUserId]);

  useEffect(() => {
    if (selectedUserId && users.length > 0 && !users.some((u) => u.id === selectedUserId)) {
      setSelectedUserId(null);
      setPin('');
    }
  }, [users, selectedUserId]);

  const pickerOptions: PickerOption[] = useMemo(
    () => users.map((u) => ({ value: u.id, label: u.fullName, sublabel: `@${u.username}` })),
    [users]
  );

  // Ref pattern: handleKey'i ömür boyu sabit fonksiyon referansı yapıyoruz ki
  // memo'lu NumpadKey'ler her tuş basışında re-render olmasın.
  const pinRef = useRef(pin);
  const submittingRef = useRef(submitting);
  const selectedUserRef = useRef(selectedUser);
  const methodRef = useRef<LoginMethod>(activeMethod);
  const pinInputRef = useRef<TextInput>(null);
  useEffect(() => {
    pinRef.current = pin;
  }, [pin]);
  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);
  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);
  useEffect(() => {
    methodRef.current = activeMethod;
  }, [activeMethod]);

  const submit = useCallback(
    async (rawPin: string, user: MobileUser) => {
      setSubmitting(true);
      setError('');
      try {
        const res = await authService.login({ username: user.username, password: rawPin });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({ type: 'success', text1: 'Hoş geldin', text2: user.fullName });
        await setAuth(res.data.user, res.data.token);
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const msg = e instanceof Error ? e.message : 'Hatalı PIN.';
        setError(msg);
        setPin('');
        Toast.show({ type: 'error', text1: 'Giriş başarısız', text2: msg });
      } finally {
        setSubmitting(false);
      }
    },
    [setAuth],
  );

  // Yöntem 403'ü (panelden kapatılmış) → yerel seçimi bırak + ayarı ANINDA tazele;
  // ekran öncelikli (etkin) yönteme kendiliğinden döner.
  const refetchMethods = methodsQ.refetch;
  const handleMethodDisabled = useCallback(
    (e: unknown): boolean => {
      const status = (e as { status?: number })?.status;
      if (status !== 403) return false;
      setPickedMethod(null);
      setMethodPickerOpen(false);
      void refetchMethods();
      return true;
    },
    [refetchMethods],
  );

  // SALT hızlı-PIN girişi — kullanıcı seçme yok; PIN benzersiz olduğundan kimliği
  // tek başına belirler (backend findUnique).
  const submitQuickPin = useCallback(
    async (rawPin: string) => {
      setSubmitting(true);
      setError('');
      try {
        const res = await authService.loginWithQuickPin(rawPin);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({ type: 'success', text1: 'Hoş geldin', text2: res.data.user.username });
        await setAuth(res.data.user, res.data.token);
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const msg = e instanceof Error ? e.message : 'PIN tanınmadı.';
        setError(msg);
        setPin('');
        handleMethodDisabled(e);
        Toast.show({ type: 'error', text1: 'Giriş başarısız', text2: msg, visibilityTime: 6000 });
      } finally {
        setSubmitting(false);
      }
    },
    [setAuth, handleMethodDisabled],
  );

  // QR personel kartıyla giriş — okutma başarılıysa PIN'siz doğrudan token alınır.
  const submitCard = useCallback(
    async (cardCode: string) => {
      setSubmitting(true);
      setError('');
      try {
        const res = await authService.loginWithCard(cardCode.trim());
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({ type: 'success', text1: 'Hoş geldin', text2: res.data.user.username });
        await setAuth(res.data.user, res.data.token);
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const msg = e instanceof Error ? e.message : 'Kart okunamadı.';
        setError(msg);
        handleMethodDisabled(e);
        Toast.show({ type: 'error', text1: 'Giriş başarısız', text2: msg, visibilityTime: 6000 });
      } finally {
        setSubmitting(false);
      }
    },
    [setAuth, handleMethodDisabled],
  );

  // 6 hane dolunca yönteme göre gönder: 'pin' = salt hızlı-PIN (kullanıcı yok);
  // 'list' = seçili kullanıcı + şifre.
  const submitPinByMethod = useCallback(
    (fullPin: string) => {
      if (methodRef.current === 'pin') {
        void submitQuickPin(fullPin);
        return;
      }
      const currentUser = selectedUserRef.current;
      if (currentUser) void submit(fullPin, currentUser);
    },
    [submit, submitQuickPin],
  );

  const handleKey = useCallback(
    (cell: Cell) => {
      const currentPin = pinRef.current;
      const currentSubmitting = submittingRef.current;
      // Liste görünümünde kullanıcı seçilmeden PIN girilmez; salt-PIN'de gerekmez.
      const needsUser = methodRef.current === 'list';
      if (currentSubmitting || (needsUser && !selectedUserRef.current) || cell.type === 'empty') return;
      if (cell.type === 'backspace') {
        if (currentPin.length === 0) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setPin(currentPin.slice(0, -1));
        setError('');
        return;
      }
      if (currentPin.length >= PIN_LENGTH) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const next = currentPin + cell.key;
      setPin(next);
      setError('');
      if (next.length === PIN_LENGTH) submitPinByMethod(next);
    },
    [submitPinByMethod],
  );

  // Telefon/dikey modda donanım numpad'i yerine Android sayı klavyesi kullanılıyor.
  const handlePinChange = useCallback(
    (text: string) => {
      const needsUser = methodRef.current === 'list';
      if ((needsUser && !selectedUserRef.current) || submittingRef.current) return;
      const digits = text.replace(/\D/g, '').slice(0, PIN_LENGTH);
      setPin(digits);
      setError('');
      if (digits.length === PIN_LENGTH) submitPinByMethod(digits);
    },
    [submitPinByMethod],
  );

  // Telefon modu: görünmez TextInput'a odaklanıp Android sayı klavyesini açar.
  // Klavye dışarı dokunarak kapatıldığında EditText odakta kalır; aynı input'a
  // tekrar focus() çağırmak IME'yi geri açmaz. Bu yüzden odaktaysa önce blur edip
  // bir frame sonra yeniden odaklanıyoruz — odak değişimi klavyeyi geri getiriyor.
  const focusPin = useCallback(() => {
    const needsUser = methodRef.current === 'list';
    if (submittingRef.current || (needsUser && !selectedUserRef.current)) return;
    const input = pinInputRef.current;
    if (!input) return;
    if (input.isFocused()) {
      input.blur();
      requestAnimationFrame(() => pinInputRef.current?.focus());
    } else {
      input.focus();
    }
  }, []);

  const numpadDisabled = (activeMethod === 'list' && !selectedUser) || submitting;

  const userSection = (
    <>
      <Text style={styles.sectionLabel}>1 · KULLANICI</Text>
      {selectedUser ? (
        <UserCard user={selectedUser} disabled={submitting} onChange={() => setPickerVisible(true)} />
      ) : (
        <SelectPrompt
          loading={usersQuery.isLoading}
          error={usersQuery.isError}
          count={users.length}
          onPress={() => setPickerVisible(true)}
        />
      )}

      {usersQuery.isError && (
        <TouchableRipple
          onPress={() => void usersQuery.refetch()}
          style={styles.retryBtn}
          rippleColor="rgba(255,255,255,0.2)"
        >
          <View style={styles.retryBtnInner}>
            {usersQuery.isRefetching ? (
              <ActivityIndicator size={16} color="#fff" />
            ) : (
              <Icon source="refresh" size={18} color="#fff" />
            )}
            <Text style={styles.retryBtnText}>Listeyi yenile</Text>
          </View>
        </TouchableRipple>
      )}
    </>
  );

  const pinSection = (
    <>
      <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>2 · PIN (6 HANE)</Text>
      <View style={[styles.pinRow, isCompact && styles.pinRowCompact]}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.pinDot,
              i < pin.length && styles.pinDotFilled,
              i === pin.length && !!selectedUser && !submitting && styles.pinDotActive,
              !!error && styles.pinDotError,
            ]}
          />
        ))}
      </View>

      <View style={[styles.statusRow, isCompact && styles.statusRowCompact]}>
        {submitting ? (
          <>
            <ActivityIndicator size={16} color={COLORS.accentLight} />
            <Text style={styles.statusText}>Giriş yapılıyor...</Text>
          </>
        ) : error ? (
          <>
            <Icon source="alert-circle" size={18} color={COLORS.error} />
            <Text style={styles.errorText}>{error}</Text>
          </>
        ) : (
          <Text style={styles.statusText}>
            {!selectedUser
              ? 'Önce kullanıcı seç'
              : pin.length === 0
                ? '6 haneli PIN gir'
                : `${pin.length} / ${PIN_LENGTH}`}
          </Text>
        )}
      </View>
    </>
  );

  // Telefon/dikey: donanım numpad'i yok — noktalar dokunulunca Android sayı
  // klavyesini açan görünmez bir TextInput'a odaklanır. Klavye nav çubuğunun
  // üstünden açıldığı için dock sorunu yaşanmaz.
  const pinSectionCompact = (
    <>
      <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>2 · PIN (6 HANE)</Text>
      <TouchableRipple
        onPress={focusPin}
        disabled={!selectedUser || submitting}
        rippleColor="rgba(99,102,241,0.25)"
        borderless
        style={styles.pinInputTap}
      >
        <View style={styles.pinInputWrap}>
          <View style={[styles.pinRow, styles.pinRowCompact]}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.pinDot,
                  i < pin.length && styles.pinDotFilled,
                  i === pin.length && !!selectedUser && !submitting && styles.pinDotActive,
                  !!error && styles.pinDotError,
                ]}
              />
            ))}
          </View>
          {!!selectedUser && (
            <TextInput
              ref={pinInputRef}
              value={pin}
              onChangeText={handlePinChange}
              keyboardType="number-pad"
              maxLength={PIN_LENGTH}
              autoFocus
              caretHidden
              // Görünmez overlay olduğu için sistemin çizdiği görsel öğeleri bastır:
              // Android autofill vurgu kutusu, seçim tutamağı ve bağlam menüsü
              // aksi halde noktaların üstünde görünür artefakt bırakıyordu.
              importantForAutofill="no"
              autoComplete="off"
              autoCorrect={false}
              contextMenuHidden
              selectTextOnFocus={false}
              editable={!submitting}
              returnKeyType="done"
              underlineColorAndroid="transparent"
              // Dokunmalar üstteki TouchableRipple'a gitsin (overlayInput'taki
              // pointerEvents:'none'); odak yalnızca focusPin() ile programatik.
              style={styles.overlayInput}
            />
          )}
        </View>
      </TouchableRipple>

      <Text style={styles.pinHelper}>Hane girmek için dokunun</Text>

      <View style={[styles.statusRow, styles.statusRowCompact]}>
        {submitting ? (
          <>
            <ActivityIndicator size={16} color={COLORS.accentLight} />
            <Text style={styles.statusText}>Giriş yapılıyor...</Text>
          </>
        ) : error ? (
          <>
            <Icon source="alert-circle" size={18} color={COLORS.error} />
            <Text style={styles.errorText}>{error}</Text>
          </>
        ) : (
          <Text style={styles.statusText}>
            {!selectedUser
              ? 'Önce kullanıcı seç'
              : pin.length === 0
                ? '6 haneli PIN gir'
                : `${pin.length} / ${PIN_LENGTH}`}
          </Text>
        )}
      </View>
    </>
  );

  const numpad = (
    <View style={[styles.numpad, isCompact && styles.numpadCompact]}>
      {NUMPAD_ROWS.map((row, ri) => (
        <View key={ri} style={[styles.numpadRow, isCompact && styles.numpadRowCompact]}>
          {row.map((cell, ci) => {
            if (cell.type === 'empty') {
              return (
                <View
                  key={ci}
                  style={[styles.numpadKeyPlaceholder, isCompact && styles.numpadKeyCompact]}
                />
              );
            }
            const isBack = cell.type === 'backspace';
            const keyDisabled = numpadDisabled || (isBack && pin.length === 0);
            return (
              <NumpadKey
                key={ci}
                cell={cell}
                isCompact={isCompact}
                disabled={keyDisabled}
                onPress={handleKey}
              />
            );
          })}
        </View>
      ))}
    </View>
  );

  // Yöntem değiştirici — "Diğer giriş yöntemlerini dene" → diğer ETKİN yöntemler
  // tam-genişlik, ayrı renkli butonlar olarak ALT ALTA çıkar (fabrikada tek
  // bakışta ayırt edilsin). QR kart seçilirse KAMERA DOĞRUDAN açılır — araya
  // "Kartı Okut" sayfası girmez (kullanıcı isteği).
  const otherMethods = enabledMethods.filter((m) => m !== activeMethod);
  const switchMethod = (m: LoginMethod) => {
    setPickedMethod(m);
    setMethodPickerOpen(false);
    setPin('');
    setError('');
    if (m === 'card') setCardScannerOpen(true);
  };
  const methodSwitcher =
    otherMethods.length === 0 ? null : (
      <View style={styles.methodSwitchWrap}>
        {!methodPickerOpen ? (
          // Kapalı hal — GERÇEK buton gibi görünmeli (altı çizili metin değil):
          // çerçeveli, tam genişlik, dokunma hedefi büyük.
          <TouchableRipple
            onPress={() => setMethodPickerOpen(true)}
            rippleColor="rgba(255,255,255,0.15)"
            style={styles.methodTriggerBtn}
          >
            <View style={styles.methodTriggerInner}>
              <Icon source="swap-horizontal" size={22} color="#c7d2fe" />
              <Text style={styles.methodTriggerText}>Diğer giriş yöntemlerini dene</Text>
              <Icon source="chevron-down" size={22} color={COLORS.subtext} />
            </View>
          </TouchableRipple>
        ) : (
          // Açık hal — tetik metni BAŞLIK olarak kalır, seçenekler altında.
          <View style={styles.methodColumn}>
            <Text style={styles.methodHeader}>DİĞER GİRİŞ YÖNTEMLERİ</Text>
            {otherMethods.map((m) => (
              <TouchableRipple
                key={m}
                onPress={() => switchMethod(m)}
                rippleColor="rgba(255,255,255,0.25)"
                style={[styles.methodBtn, { backgroundColor: METHOD_META[m].color }]}
              >
                <View style={styles.methodBtnInner}>
                  <Icon source={METHOD_META[m].icon} size={26} color="#fff" />
                  <Text style={styles.methodBtnText}>{METHOD_META[m].label}</Text>
                </View>
              </TouchableRipple>
            ))}
          </View>
        )}
      </View>
    );

  // Kart görünümü — QR personel kartıyla giriş.
  const cardSection = (
    <View style={styles.cardPanel}>
      <Icon source="card-account-details-outline" size={72} color={COLORS.accentLight} />
      <Text style={styles.cardTitle}>Personel Kartını Okut</Text>
      <Text style={styles.cardHint}>
        Kartındaki QR'ı kameraya göster — kullanıcı seçme ve PIN gerekmez.
      </Text>
      <TouchableRipple
        onPress={() => {
          setError('');
          setCardScannerOpen(true);
        }}
        disabled={submitting}
        rippleColor="rgba(255,255,255,0.2)"
        style={styles.cardScanBtn}
      >
        <View style={styles.cardScanBtnInner}>
          {submitting ? (
            <ActivityIndicator size={22} color="#fff" />
          ) : (
            <Icon source="qrcode-scan" size={24} color="#fff" />
          )}
          <Text style={styles.cardScanBtnText}>
            {submitting ? 'Giriş yapılıyor…' : 'Kartı Okut'}
          </Text>
        </View>
      </TouchableRipple>
      {!!error && (
        <View style={styles.statusRow}>
          <Icon source="alert-circle" size={18} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {methodSwitcher}
    </View>
  );

  // SALT hızlı-PIN görünümü — kullanıcı seçme yok; PIN benzersiz, kimliği belirler.
  const quickPinStatus = (
    <View style={[styles.statusRow, isCompact && styles.statusRowCompact]}>
      {submitting ? (
        <>
          <ActivityIndicator size={16} color={COLORS.accentLight} />
          <Text style={styles.statusText}>Giriş yapılıyor...</Text>
        </>
      ) : error ? (
        <>
          <Icon source="alert-circle" size={18} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
        </>
      ) : (
        <Text style={styles.statusText}>
          {pin.length === 0 ? '6 haneli hızlı PIN\'ini gir' : `${pin.length} / ${PIN_LENGTH}`}
        </Text>
      )}
    </View>
  );

  const quickPinDots = (
    <View style={[styles.pinRow, isCompact && styles.pinRowCompact]}>
      {Array.from({ length: PIN_LENGTH }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.pinDot,
            i < pin.length && styles.pinDotFilled,
            i === pin.length && !submitting && styles.pinDotActive,
            !!error && styles.pinDotError,
          ]}
        />
      ))}
    </View>
  );

  const quickPinSection = (
    <>
      <Text style={styles.sectionLabel}>HIZLI PIN İLE GİRİŞ</Text>
      <Text style={styles.quickPinHint}>
        Sana özel 6 haneli hızlı PIN'i gir — kullanıcı seçmene gerek yok.
      </Text>
      {quickPinDots}
      {quickPinStatus}
    </>
  );

  const quickPinSectionCompact = (
    <>
      <Text style={styles.sectionLabel}>HIZLI PIN İLE GİRİŞ</Text>
      <Text style={styles.quickPinHint}>
        Sana özel 6 haneli hızlı PIN'i gir — kullanıcı seçmene gerek yok.
      </Text>
      <TouchableRipple
        onPress={focusPin}
        disabled={submitting}
        rippleColor="rgba(99,102,241,0.25)"
        borderless
        style={styles.pinInputTap}
      >
        <View style={styles.pinInputWrap}>
          {quickPinDots}
          <TextInput
            ref={pinInputRef}
            value={pin}
            onChangeText={handlePinChange}
            keyboardType="number-pad"
            maxLength={PIN_LENGTH}
            autoFocus
            caretHidden
            importantForAutofill="no"
            autoComplete="off"
            autoCorrect={false}
            contextMenuHidden
            selectTextOnFocus={false}
            editable={!submitting}
            returnKeyType="done"
            underlineColorAndroid="transparent"
            style={styles.overlayInput}
          />
        </View>
      </TouchableRipple>
      <Text style={styles.pinHelper}>Hane girmek için dokunun</Text>
      {quickPinStatus}
    </>
  );

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { paddingBottom: insets.bottom }]}
    >
      <TopBar compact={isCompact} />

      {activeMethod === 'card' ? (
        <ScrollView contentContainerStyle={styles.cardWrap} keyboardShouldPersistTaps="handled">
          {cardSection}
        </ScrollView>
      ) : activeMethod === 'pin' ? (
        isCompact ? (
          <ScrollView
            contentContainerStyle={styles.compactContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.compactSection}>{quickPinSectionCompact}</View>
            {methodSwitcher}
          </ScrollView>
        ) : (
          <View style={styles.main}>
            <View style={styles.leftPanel}>
              {quickPinSection}
              {methodSwitcher}
            </View>
            <View style={styles.rightPanel}>{numpad}</View>
          </View>
        )
      ) : isCompact ? (
        <ScrollView
          contentContainerStyle={styles.compactContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.compactSection}>{userSection}</View>
          <View style={styles.compactSection}>{pinSectionCompact}</View>
          {methodSwitcher}
        </ScrollView>
      ) : (
        <View style={styles.main}>
          <View style={styles.leftPanel}>
            {userSection}
            {pinSection}
            {methodSwitcher}
          </View>
          <View style={styles.rightPanel}>{numpad}</View>
        </View>
      )}

      <BarcodeScannerModal
        visible={cardScannerOpen}
        onDismiss={() => setCardScannerOpen(false)}
        onScan={(code) => {
          setCardScannerOpen(false);
          void submitCard(code);
        }}
        title="Personel kartını okut"
        notice="Kartındaki QR kodu kameraya göster"
      />

      <PickerModal
        visible={pickerVisible}
        title="Kullanıcı Seç"
        options={pickerOptions}
        selectedValue={selectedUserId}
        numColumns={isCompact ? 1 : 3}
        onRefresh={() => void usersQuery.refetch()}
        refreshing={usersQuery.isRefetching}
        refreshError={usersQuery.isError}
        refreshErrorMessage={
          usersQuery.error instanceof Error ? usersQuery.error.message : undefined
        }
        onSelect={(val) => {
          setSelectedUserId(val);
          setPin('');
          setError('');
        }}
        onDismiss={() => setPickerVisible(false)}
        emptyText="Aktif mobil kullanıcı yok"
        loading={usersQuery.isLoading}
      />
    </SafeAreaView>
  );
}

// Numpad tek tuş — React.memo ile sarılı, parent her tuş basışında render olsa
// bile props (cell sabit, isCompact/disabled değişmediği sürece, onPress stable)
// aynı kaldığında bu cell hiç yeniden render olmaz.
const NumpadKey = React.memo(function NumpadKey({
  cell,
  isCompact,
  disabled,
  onPress,
}: {
  cell: Cell;
  isCompact: boolean;
  disabled: boolean;
  onPress: (cell: Cell) => void;
}) {
  const isBack = cell.type === 'backspace';
  const handlePress = useCallback(() => onPress(cell), [cell, onPress]);
  return (
    <TouchableRipple
      onPress={handlePress}
      disabled={disabled}
      rippleColor="rgba(99,102,241,0.3)"
      style={[
        styles.numpadKey,
        isCompact && styles.numpadKeyCompact,
        isBack && styles.numpadKeyBackspace,
        disabled && styles.numpadKeyDisabled,
      ]}
    >
      <View style={styles.numpadKeyContent}>
        {isBack ? (
          <Icon
            source="backspace-outline"
            size={isCompact ? 30 : 36}
            color={disabled ? '#7f1d1d' : COLORS.backspaceIcon}
          />
        ) : (
          <Text
            style={[
              styles.numpadKeyText,
              isCompact && styles.numpadKeyTextCompact,
              disabled && styles.numpadKeyTextDisabled,
            ]}
          >
            {cell.key}
          </Text>
        )}
      </View>
    </TouchableRipple>
  );
});

function TopBar({ compact }: { compact: boolean }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={[styles.topBar, compact && styles.topBarCompact]}>
      <Image
        source={require('../../../assets/logo.png')}
        style={styles.logoImg}
        resizeMode="cover"
        accessibilityLabel="TeksERP logosu"
      />
      <View style={styles.brandTextGroup}>
        <Text style={styles.brandName}>TeksERP</Text>
        <Text style={styles.brandSub}>Üretim Yönetim Sistemi</Text>
      </View>
      {!compact && (
        <Text style={styles.shiftHint}>Vardiya değişimi · adına dokun, 6 haneli PIN gir</Text>
      )}
      <IconButton
        icon="cog"
        iconColor={COLORS.subtext}
        size={24}
        onPress={() => navigation.navigate('Settings')}
        accessibilityLabel="Sunucu ayarları"
      />
    </View>
  );
}

function UserCard({
  user,
  disabled,
  onChange,
}: {
  user: MobileUser;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <TouchableRipple
      onPress={onChange}
      disabled={disabled}
      rippleColor="rgba(99,102,241,0.2)"
      style={styles.userCard}
    >
      <View style={styles.userCardInner}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(user.fullName)}</Text>
        </View>
        <View style={styles.userCardText}>
          <Text style={styles.userName} numberOfLines={1}>{user.fullName}</Text>
          <Text style={styles.userUsername} numberOfLines={1}>@{user.username}</Text>
        </View>
        <View style={styles.changeChip}>
          <Icon source="account-switch" size={18} color={COLORS.accentLight} />
          <Text style={styles.changeChipText}>Değiştir</Text>
        </View>
      </View>
    </TouchableRipple>
  );
}

function SelectPrompt({
  loading,
  error,
  count,
  onPress,
}: {
  loading: boolean;
  error: boolean;
  count: number;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      disabled={loading || count === 0}
      rippleColor="rgba(99,102,241,0.2)"
      style={styles.selectPrompt}
    >
      <View style={styles.selectPromptInner}>
        {loading ? (
          <ActivityIndicator color={COLORS.accent} />
        ) : (
          <>
            <Icon source="account-circle-outline" size={48} color={COLORS.accentLight} />
            <Text style={styles.selectPromptText}>Kullanıcı Seç</Text>
            <Text style={styles.selectPromptHint}>
              {error
                ? 'Liste alınamadı — tekrar dene'
                : count === 0
                  ? 'Aktif mobil kullanıcı yok'
                  : `${count} kullanıcı`}
            </Text>
          </>
        )}
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  // Kart modu (QR personel kartı)
  cardWrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  cardPanel: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.bgSoft,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 28,
  },
  cardTitle: { color: COLORS.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  cardHint: { color: COLORS.subtext, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  cardScanBtn: {
    marginTop: 8,
    alignSelf: 'stretch',
    borderRadius: 14,
    backgroundColor: COLORS.accent,
  },
  cardScanBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 60,
  },
  cardScanBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  // Yöntem değiştirici ("Diğer giriş yöntemlerini dene" → seçenek butonları).
  // Butonlar tam genişlik + ALT ALTA + ayrı renkler — saha ayırt edilebilirliği.
  methodSwitchWrap: { alignSelf: 'stretch', alignItems: 'center', marginTop: 22 },
  // Kapalı hal tetiği — buton gibi: çerçeveli, tam genişlik, büyük dokunma hedefi.
  methodTriggerBtn: {
    alignSelf: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgSoft,
  },
  methodTriggerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18,
    minHeight: 56,
  },
  methodTriggerText: { color: '#c7d2fe', fontSize: 16, fontWeight: '700' },
  // Açık hal başlığı — tetik metni başlık olarak kalır.
  methodHeader: {
    color: COLORS.subtext,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 2,
  },
  methodColumn: { alignSelf: 'stretch', gap: 12 },
  methodBtn: {
    alignSelf: 'stretch',
    borderRadius: 14,
  },
  methodBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 18,
    minHeight: 62,
  },
  methodBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  quickPinHint: { color: COLORS.subtext, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 12 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
    backgroundColor: COLORS.bgDarker,
  },
  topBarCompact: { paddingHorizontal: 16, paddingVertical: 10 },
  logoImg: { width: 44, height: 44, borderRadius: 11 },
  brandTextGroup: { flex: 1 },
  brandName: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  brandSub: { color: COLORS.subtext, fontSize: 12 },
  shiftHint: { color: COLORS.subtext, fontSize: 13, fontStyle: 'italic' },

  main: { flex: 1, flexDirection: 'row' },
  leftPanel: { flex: 1, padding: 32, justifyContent: 'center' },
  rightPanel: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: COLORS.bgSoft,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.borderDark,
  },

  compactContent: { padding: 20, paddingBottom: 32, gap: 16 },
  compactSection: {},
  compactNumpadWrap: { marginTop: 4 },

  sectionLabel: {
    color: COLORS.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  sectionLabelSpaced: { marginTop: 28 },

  userCard: {
    backgroundColor: COLORS.bgSoft,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 14,
    padding: 14,
  },
  userCardInner: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  userCardText: { flex: 1 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  userName: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  userUsername: { color: COLORS.subtext, fontSize: 13, marginTop: 2 },
  changeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgDarker,
  },
  changeChipText: { color: COLORS.accentLight, fontSize: 12, fontWeight: '700' },

  selectPrompt: {
    backgroundColor: COLORS.bgSoft,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    borderRadius: 14,
    minHeight: 124,
  },
  selectPromptInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  selectPromptText: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  selectPromptHint: { color: COLORS.subtext, fontSize: 13 },

  retryBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: COLORS.accent,
    borderRadius: 10,
  },
  retryBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  pinRow: { flexDirection: 'row', gap: 14 },
  pinRowCompact: { gap: 10, justifyContent: 'center' },
  // Dokunma hedefi: noktaların etrafını sarar, min 56dp yükseklik için padding.
  pinInputTap: { alignSelf: 'center', borderRadius: 14 },
  pinInputWrap: { position: 'relative', paddingVertical: 14, paddingHorizontal: 18 },
  pinHelper: { color: COLORS.subtext, fontSize: 12, textAlign: 'center', marginTop: 8 },
  overlayInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // opacity:0 tüm view'i (autofill kutusu/imleç/seçim tutamağı dahil) gizler;
    // transparent renk tek başına sistemin çizdiği öğeleri durdurmuyordu.
    opacity: 0,
    // Dokunmaları üstteki TouchableRipple'a bırak — odaklanma focusPin() ile yapılır.
    pointerEvents: 'none',
    color: 'transparent',
    backgroundColor: 'transparent',
    textAlign: 'center',
  },
  pinDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.pinEmpty,
    backgroundColor: 'transparent',
  },
  pinDotFilled: { backgroundColor: COLORS.accentLight, borderColor: COLORS.accentLight },
  pinDotActive: { borderColor: COLORS.accentLight },
  pinDotError: { borderColor: COLORS.error },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    minHeight: 24,
  },
  statusRowCompact: { justifyContent: 'center' },
  statusText: { color: COLORS.subtext, fontSize: 14 },
  errorText: { color: COLORS.error, fontSize: 14, fontWeight: '600', flex: 1 },

  numpad: { gap: 14, maxWidth: 460, alignSelf: 'center', width: '100%' },
  numpadCompact: { gap: 10, maxWidth: 360 },
  numpadRow: { flexDirection: 'row', gap: 14 },
  numpadRowCompact: { gap: 10 },
  numpadKey: {
    flex: 1,
    height: 84,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
    overflow: 'hidden',
  },
  numpadKeyCompact: { height: 68, borderRadius: 12 },
  numpadKeyBackspace: {
    backgroundColor: COLORS.backspaceBg,
    borderColor: COLORS.backspaceBorder,
  },
  numpadKeyDisabled: { opacity: 0.4 },
  numpadKeyPlaceholder: { flex: 1, height: 84 },
  numpadKeyContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  numpadKeyText: { color: COLORS.text, fontSize: 34, fontWeight: '700' },
  numpadKeyTextCompact: { fontSize: 28 },
  numpadKeyTextDisabled: { color: '#475569' },
});
