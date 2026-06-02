import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  TextInput,
  IconButton,
  Button,
  ActivityIndicator,
} from 'react-native-paper';

import { useDeviceSettingsStore } from '../store/deviceSettingsStore';

// =============================================================================
// ScannerEntryBar — barkod/refakat kartı giriş bandı için ortak satır.
//
// Üç farklı modda render eder:
//
//   1) `manualMode = true` (Ayarlar → "Kamera arızalı")
//      [TextInput .....................] [📷 Kamera] [📋 Liste] [extra?]
//
//   2) `manualMode = false` + `compactCta = false`  (default)
//      [   📷  Kamera ile Okut    ]  [📋 Liste]
//      → Büyük CTA + yan liste ikonu (FasonSevk pattern'i)
//
//   3) `manualMode = false` + `compactCta = true`
//      Hiçbir şey render edilmez — parent kendi tasarımını render eder
//      (örn. Tambur'un 4-icon kompakt satırı). `manualMode` true olunca
//      otomatik input bandı görünür.
//
// `manualMode` prop'u geçilmezse store'dan okur — operatör Ayarlar'dan toggle
// ettiğinde tüm ekranlar aynı anda davranış değiştirir.
//
// İmza minimal tutuldu: kalan UI çeşitliliği (urgent badge, "Ekle" butonu)
// `listBadge` ve `extra` slot'larıyla parent'a bırakıldı.
// =============================================================================

type Tone = 'blue' | 'green' | 'indigo';

interface ToneColors {
  scanContainer: string;
  scanIcon: string;
  scanButton: string;   // mode="contained" buttonColor
  resolveColor: string; // input check ikonu ve loading spinner rengi
}

const TONES: Record<Tone, ToneColors> = {
  blue:   { scanContainer: '#dbeafe', scanIcon: '#1e40af', scanButton: '#1e40af', resolveColor: '#1e40af' },
  green:  { scanContainer: '#d1fae5', scanIcon: '#059669', scanButton: '#059669', resolveColor: '#059669' },
  indigo: { scanContainer: '#eef2ff', scanIcon: '#4f46e5', scanButton: '#4f46e5', resolveColor: '#4f46e5' },
};

interface Props {
  // Manuel input — manualMode true olduğunda kullanılır.
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  /** Input submit veya check ikonuna basışta. Manuel mode'da görünür. */
  onResolve?: () => void;
  /** Submit sırasında spinner ve disabled için. */
  resolving?: boolean;
  /** Input'u tamamen disable etmek için (örn. backend operation devam ederken). */
  inputDisabled?: boolean;
  /** Solda gösterilen TextInput.Icon (default: card-search-outline). */
  inputLeftIcon?: string;

  // Aksiyon butonları
  onScan?: () => void;
  /** Default mode CTA label. Default: "Kamera ile Okut". */
  scanCtaLabel?: string;
  /** Renk teması. Default 'blue'. */
  tone?: Tone;

  /** Liste butonu — geçilmezse hiç render edilmez. */
  onList?: () => void;
  /** Liste butonuna eklenen overlay (örn. KursunQc urgent badge). */
  listBadge?: React.ReactNode;
  /** Liste butonu renk override (default gri). Dinamik renk için
   *  (örn. KursunQc'de urgent count varken kırmızı). */
  listContainerColor?: string;
  listIconColor?: string;

  /** 3. ekstra buton (manuel mode'da kamera+liste yanına; default mode'da
   *  render edilmez — büyük CTA varken yer almaz). FasonSevk "Ekle" gibi. */
  extra?: React.ReactNode;

  /** Override: store'dan değil prop'tan oku. Test/özel durum için. */
  manualMode?: boolean;
  /** Kamera-only modda bar'ı tamamen gizler (parent kendi tasarımını
   *  render edecek — Tambur 4-icon pattern'i için). */
  compactCta?: boolean;
}

export default function ScannerEntryBar({
  value,
  onChangeText,
  placeholder = 'Barkod gir veya okut...',
  onResolve,
  resolving = false,
  inputDisabled = false,
  inputLeftIcon = 'card-search-outline',
  onScan,
  scanCtaLabel = 'Kamera ile Okut',
  tone = 'blue',
  onList,
  listBadge,
  listContainerColor,
  listIconColor,
  extra,
  manualMode: manualModeProp,
  compactCta = false,
}: Props) {
  const manualModeStore = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const manualMode = manualModeProp ?? manualModeStore;
  const colors = TONES[tone];

  // Kamera-only + compactCta: parent kendi layout'unu kullanır.
  if (!manualMode && compactCta) return null;

  if (manualMode) {
    return (
      <View style={styles.row}>
        <TextInput
          mode="outlined"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          dense
          autoCapitalize="characters"
          autoCorrect={false}
          left={<TextInput.Icon icon={inputLeftIcon} />}
          right={
            resolving ? (
              <TextInput.Icon
                icon={() => (
                  <ActivityIndicator size={18} color={colors.resolveColor} />
                )}
              />
            ) : value.trim() && onResolve ? (
              <TextInput.Icon
                icon="check"
                onPress={onResolve}
                color={colors.resolveColor}
              />
            ) : undefined
          }
          onSubmitEditing={onResolve}
          returnKeyType="search"
          style={styles.input}
          disabled={inputDisabled || resolving}
        />
        {onScan && (
          <IconButton
            icon="camera"
            mode="contained-tonal"
            containerColor={colors.scanContainer}
            iconColor={colors.scanIcon}
            size={26}
            onPress={onScan}
            accessibilityLabel="Kamera ile okut"
            style={styles.iconBtn}
            disabled={resolving}
          />
        )}
        {onList && (
          <View>
            <IconButton
              icon="format-list-bulleted"
              mode="contained-tonal"
              containerColor={listContainerColor ?? '#f1f5f9'}
              iconColor={listIconColor ?? '#475569'}
              size={26}
              onPress={onList}
              accessibilityLabel="Listeden seç"
              style={styles.iconBtn}
              disabled={resolving}
            />
            {listBadge}
          </View>
        )}
        {extra}
      </View>
    );
  }

  // Kamera-only: büyük CTA + opsiyonel liste icon
  return (
    <View style={styles.row}>
      <Button
        mode="contained"
        icon={resolving ? undefined : 'camera'}
        buttonColor={colors.scanButton}
        onPress={onScan ?? undefined}
        disabled={resolving || !onScan}
        style={styles.cta}
        contentStyle={styles.ctaContent}
        labelStyle={styles.ctaLabel}
      >
        {resolving ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          scanCtaLabel
        )}
      </Button>
      {onList && (
        <View>
          <IconButton
            icon="format-list-bulleted"
            mode="contained-tonal"
            containerColor="#f1f5f9"
            iconColor="#475569"
            size={28}
            onPress={onList}
            accessibilityLabel="Listeden seç"
            style={styles.ctaListBtn}
            disabled={resolving}
          />
          {listBadge}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, backgroundColor: '#fff' },
  iconBtn: { margin: 0, height: 48, width: 48, borderRadius: 8 },

  cta: { flex: 1, borderRadius: 10 },
  ctaContent: { height: 56 },
  ctaLabel: { fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  // CTA ile aynı yükseklik + köşe — liste icon yanında oturduğunda eşit hizalansın.
  ctaListBtn: { margin: 0, height: 56, width: 56, borderRadius: 10 },
});
