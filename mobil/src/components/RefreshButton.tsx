import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { IconButton, TouchableRipple, Text, Icon } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

interface Props {
  onPress: () => void;
  /** Yenileme/fetch sürerken animasyon döner; true→false geçişi bitiş haptic'i tetikler. */
  refreshing: boolean;
  /** Sorgu son halinde başarısızsa true → error haptic + error toast. */
  isError?: boolean;
  /** Hata mesajı (error toast'ta gösterilir). */
  errorMessage?: string;
  /** Başarı mesajı — sağlanırsa yenileme tamamlanınca success toast gösterilir. */
  successMessage?: string;
  /** Stil override — default variant'ta Animated.View container'a, headerStyle
   *  chip modunda TouchableRipple'a (dokunma alanı) uygulanır. */
  containerStyle?: ViewStyle;
  /** İkon boyutu — default 18. */
  size?: number;
  /** Header dark chip modunda render et — AppBar içindeki dark header'a uygun beyaz ikon + pill stil. */
  headerStyle?: boolean;
  /** Header chip modunda ikonun yanında gösterilen etiket. */
  label?: string;
  /** Header chip accent rengi (koyu mavi). */
  accent?: boolean;
}

/**
 * Yenile (refresh) butonu — dönen animasyon + haptic + isteğe bağlı toast.
 *
 * `headerStyle=true` ile AppBar dark header'ına uygun beyaz pill chip olarak render edilir.
 * Default variant'ta beyaz arka plan üzerinde mor IconButton olarak görünür.
 */
export default function RefreshButton({
  onPress,
  refreshing,
  isError = false,
  errorMessage,
  successMessage,
  containerStyle,
  size = 18,
  headerStyle = false,
  label,
  accent = false,
}: Props) {
  const spin = useRef(new Animated.Value(0)).current;
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const animatingRef = useRef(false);
  const prevRefreshing = useRef(refreshing);

  const runRotation = useCallback(() => {
    if (animatingRef.current) return;
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

  useEffect(() => {
    if (prevRefreshing.current && !refreshing) {
      if (isError) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        Toast.show({
          type: 'error',
          text1: 'Yenileme başarısız',
          text2: errorMessage,
        });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (successMessage) {
          Toast.show({ type: 'success', text1: successMessage });
        }
      }
    }
    prevRefreshing.current = refreshing;
  }, [refreshing, isError, errorMessage, successMessage]);

  const rotation = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  if (headerStyle) {
    return (
      <TouchableRipple
        onPress={handlePress}
        style={[hdrStyles.chip, accent && hdrStyles.chipAccent, containerStyle]}
        borderless
        rippleColor="rgba(255,255,255,0.2)"
        accessibilityLabel={label ?? 'Yenile'}
      >
        <View style={hdrStyles.chipInner}>
          <Animated.View style={{ transform: [{ rotate: rotation }] }}>
            <Icon source="refresh" size={18} color="#fff" />
          </Animated.View>
          {label && <Text style={hdrStyles.chipText}>{label}</Text>}
        </View>
      </TouchableRipple>
    );
  }

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

const hdrStyles = StyleSheet.create({
  chip: {
    borderRadius: 10,
    marginLeft: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  chipAccent: {
    backgroundColor: 'rgba(30,64,175,0.45)',
    borderColor: 'rgba(147,197,253,0.7)',
  },
  chipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
