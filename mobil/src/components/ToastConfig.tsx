import React from 'react';
import { BaseToast, ErrorToast, ToastConfig } from 'react-native-toast-message';
import { View, Text, TouchableOpacity } from 'react-native';
import { colors } from '../theme';

/** `undoable` toast'unun `props` alanı — geri alınabilir işlem bildirimi. */
interface UndoableToastProps {
  actionLabel?: string;
  onAction?: () => void;
}

export const toastConfig: ToastConfig = {
  success: (props) => (
    <BaseToast
      {...props}
      style={{ 
        borderLeftColor: '#10b981', // Emerald 500
        borderLeftWidth: 10,
        minHeight: 84,
        height: 'auto', // BaseToast'ın sabit height:60'ını ez → içerik (uzun text2) büyüsün, metin kenara değmesin
        backgroundColor: '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      }}
      contentContainerStyle={{ paddingHorizontal: 15, paddingVertical: 14 }}
      text1Style={{
        fontSize: 16,
        fontWeight: '700',
        color: '#064e3b' // Emerald 900
      }}
      text2NumberOfLines={0}
      text2Style={{
        fontSize: 14,
        color: '#065f46' // Emerald 800
      }}
    />
  ),
  error: (props) => (
    <ErrorToast
      {...props}
      style={{ 
        borderLeftColor: '#ef4444', // Red 500
        borderLeftWidth: 10,
        minHeight: 84,
        height: 'auto', // BaseToast'ın sabit height:60'ını ez → içerik (uzun text2) büyüsün, metin kenara değmesin
        backgroundColor: '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      }}
      contentContainerStyle={{ paddingHorizontal: 15, paddingVertical: 14 }}
      text1Style={{
        fontSize: 16,
        fontWeight: '700',
        color: '#7f1d1d' // Red 900
      }}
      text2NumberOfLines={0}
      text2Style={{
        fontSize: 14,
        color: '#991b1b' // Red 800
      }}
    />
  ),
  info: (props) => (
    <BaseToast
      {...props}
      style={{ 
        borderLeftColor: '#3b82f6', // Blue 500
        borderLeftWidth: 10,
        minHeight: 84,
        height: 'auto', // BaseToast'ın sabit height:60'ını ez → içerik (uzun text2) büyüsün, metin kenara değmesin
        backgroundColor: '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      }}
      contentContainerStyle={{ paddingHorizontal: 15, paddingVertical: 14 }}
      text1Style={{
        fontSize: 16,
        fontWeight: '700',
        color: '#1e3a8a' // Blue 900
      }}
      text2NumberOfLines={0}
      text2Style={{
        fontSize: 14,
        color: '#1e40af' // Blue 800
      }}
    />
  ),
  // AMBER UYARI — kayıt BAŞARILI ama sunucu `ApiResponse.warnings` döndü (ör. gövde dolu, sarım reddedilecek).
  // Başarı yeşiliyle karışmasın, hata kırmızısı da olmasın: renkler tema jetonlarından.
  warning: (props) => (
    <BaseToast
      {...props}
      style={{
        borderLeftColor: colors.warning,
        borderLeftWidth: 10,
        minHeight: 84,
        height: 'auto',
        backgroundColor: colors.surface,
        shadowColor: colors.text,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      }}
      contentContainerStyle={{ paddingHorizontal: 15, paddingVertical: 14 }}
      text1Style={{ fontSize: 16, fontWeight: '700', color: colors.warningDark }}
      text2NumberOfLines={0}
      text2Style={{ fontSize: 14, color: colors.warningText }}
    />
  ),
  /**
   * GERİ ALINABİLİR İŞLEM — "yaptım, ama şu kadar süre içinde bozabilirsin".
   *
   * Onay diyaloğunun alternatifidir, süsü değil: KK1'de top iptali tek dokunuşa
   * indirildi (sebep chip'i doğrudan iptal eder) ve o hızın karşılığı, yanlış
   * dokunuşun ekranda duran bir çıkışı olmasıdır. Butonsuz bir "iptal edildi"
   * toast'ı ile birlikte kullanılmaz — ikisinden biri seçilir.
   *
   * ⚠️ Aksiyon `props` üzerinden gelir (react-native-toast-message `props` alanı);
   * `onPress` KULLANILMADI: toast gövdesine kazara dokunmak geri almayı tetiklerdi.
   */
  undoable: ({ text1, text2, props }) => {
    const { actionLabel = 'GERİ AL', onAction } = (props ?? {}) as UndoableToastProps;
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          width: '92%',
          minHeight: 84,
          borderRadius: 8,
          borderLeftColor: '#10b981', // Emerald 500 — işlem BAŞARILI, geri alınabilir
          borderLeftWidth: 10,
          backgroundColor: '#ffffff',
          paddingHorizontal: 15,
          paddingVertical: 12,
          gap: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#064e3b' }}>
            {text1}
          </Text>
          {!!text2 && (
            <Text style={{ fontSize: 14, color: '#065f46', marginTop: 2 }}>{text2}</Text>
          )}
        </View>
        {!!onAction && (
          <TouchableOpacity
            onPress={onAction}
            // Eldivenli parmak için 48dp'lik gerçek bir hedef.
            style={{
              minHeight: 48,
              paddingHorizontal: 18,
              justifyContent: 'center',
              borderRadius: 8,
              backgroundColor: '#ecfdf5',
              borderWidth: 1,
              borderColor: '#6ee7b7',
            }}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#047857' }}>
              {actionLabel}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  },
};
