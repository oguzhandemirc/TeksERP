import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, ViewStyle } from 'react-native';
import { IconButton } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

interface Props {
  onPress: () => void;
  /** Yenileme/fetch sürerken animasyon döner; true→false geçişi başarı haptic'i tetikler. */
  refreshing: boolean;
  /** Sorgu son halinde başarısızsa true → bitiş haptic'i error olur + toast atılır. */
  isError?: boolean;
  /** İsteğe bağlı hata mesajı (toast'ta gösterilir). */
  errorMessage?: string;
  /** Stil override (örn. margin: 0). Container View'a uygulanır. */
  containerStyle?: ViewStyle;
  /** İkon boyutu — default 18. */
  size?: number;
}

/**
 * Yenile (refresh) ikon butonu — kesintisiz dönen animasyon + haptic geri bildirim.
 *
 * Davranış:
 * - `refreshing=true`: 360°/800ms linear sonsuz tur. Mid-rotation snap yok;
 *   refreshing false'a düşünce mevcut tur tamamlanır, sessizce 0°'de durur.
 * - **Art arda basılabilir** — disabled değil. React-query refetch dedupe eder.
 * - **Tap haptic:** basışta light impact (`tıkladım` geri bildirimi).
 * - **Başarı haptic:** refreshing true→false transition'ında success notification.
 *
 * Kullanım: `<RefreshButton onPress={() => query.refetch()} refreshing={query.isFetching} />`
 */
export default function RefreshButton({
  onPress,
  refreshing,
  isError = false,
  errorMessage,
  containerStyle,
  size = 18,
}: Props) {
  const spin = useRef(new Animated.Value(0)).current;
  // Animation callback `refreshing` değişimini kapanışta okumak için ref şart.
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const animatingRef = useRef(false);
  const prevRefreshing = useRef(refreshing);

  // Tek tur — bittikten sonra hâlâ refreshing ise yeni tur, değilse 360° (= 0°
  // görsel) konumunda sessizce durur.
  const runRotation = useCallback(() => {
    if (animatingRef.current) return; // Çift loop koruması
    animatingRef.current = true;
    spin.setValue(0);
    Animated.timing(spin, {
      toValue: 1,
      duration: 800,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      animatingRef.current = false;
      if (finished && refreshingRef.current) {
        runRotation();
      }
    });
  }, [spin]);

  useEffect(() => {
    if (refreshing) runRotation();
  }, [refreshing, runRotation]);

  // refreshing true→false → bitiş geri bildirimi
  // - isError true: error haptic + error toast
  // - isError false: success haptic (sessiz, toast yok — auto-fetch'lerde kirlilik olmasın)
  useEffect(() => {
    if (prevRefreshing.current && !refreshing) {
      if (isError) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => {}
        );
        Toast.show({
          type: 'error',
          text1: 'Yenileme başarısız',
          text2: errorMessage,
        });
      } else {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        ).catch(() => {});
      }
    }
    prevRefreshing.current = refreshing;
    // isError ve errorMessage transition anında okunduğu için deps'te yer almayabilir
    // ama React kuralı gereği ekledik; transition mantığı `prevRefreshing` ref'iyle korunur.
  }, [refreshing, isError, errorMessage]);

  const rotation = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Animated.View style={[{ transform: [{ rotate: rotation }] }, containerStyle]}>
      <IconButton
        icon="refresh"
        mode="contained-tonal"
        size={size}
        containerColor="#eef2ff"
        iconColor="#4f46e5"
        onPress={handlePress}
        accessibilityLabel="Yenile"
        style={styles.btn}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: { margin: 0, width: 36, height: 36 },
});
