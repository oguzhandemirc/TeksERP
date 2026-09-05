import React, { forwardRef, useCallback, useEffect, useId, useRef } from 'react';
import { TextInput as RNTextInput } from 'react-native';
import { TextInput } from 'react-native-paper';
import type { TextInputProps } from 'react-native-paper';
import { useOptionalNumpadContext, type NumpadTarget } from './NumpadProvider';

export interface NumpadInputProps
  extends Omit<TextInputProps, 'showSoftInputOnFocus' | 'onFocus' | 'value' | 'onChangeText'> {
  value: string;
  onChangeText: (next: string) => void;
  numpadLabel?: string;
  allowDecimal?: boolean;
  numpadMaxLength?: number;
  /**
   * true ise mount anında numpad'i bu input'a bağlar — kullanıcı input'a
   * tıklamadan numpad tuşları doğrudan bu input'a yazar. Bir ekranda sadece
   * BİR NumpadInput için açılmalı (aksi halde son mount eden hakim olur).
   */
  autoActivate?: boolean;
  /**
   * true ise custom Numpad'i bypass eder, sistemin kendi decimal-pad
   * klavyesini açar. Telefon ekranında daha doğal; tablette default false.
   */
  useNativeKeyboard?: boolean;
}

const ACTIVE_COLOR = '#4f46e5';

// ⚠️ MODÜL SEVİYESİNDE sabit — provider yokken kullanılan no-op'lar. Bileşen
// içinde `() => {}` yazmak KİMLİĞİ her render'da değiştirir ve aşağıdaki
// useEffect/useCallback bağımlılıklarını sürekli tetikler (2026-08-04'te tam
// bunu yapıp "Maximum update depth exceeded" sonsuz döngüsü ürettim).
const NOOP_NOTIFY = (_id: string) => {};
const NOOP_OPEN = (_target: NumpadTarget) => {};

const NumpadInput = forwardRef<RNTextInput, NumpadInputProps>(function NumpadInput(
  {
    value,
    onChangeText,
    numpadLabel,
    allowDecimal = true,
    numpadMaxLength,
    autoActivate = false,
    useNativeKeyboard = false,
    ...rest
  },
  ref
) {
  // Stable callbacks via destructure (her ikisi de provider'da useCallback([])'lı).
  //
  // ⚠️ OPSİYONEL BAĞLAM (2026-08-04 saha çökmesi): `AppModal` içeriğini portal
  // (2026-08-15'ten beri `SimplePortal`) ile ağacın BAŞKA YERİNDE render eder →
  // kural taşıyıcıdan bağımsızdır: modal içindeki NumpadInput
  // ekranın `NumpadProvider`ını GÖRMEZ. Eskiden `useNumpadContext()` burada
  // fırlatıyordu ve uygulama komple çöküyordu (Tambur → Düzelt → Manuel Top Ekle;
  // logcat: `FATAL EXCEPTION: mqt_v_native — useNumpadContext must be used inside
  // NumpadProvider`). Aynı tuzak çuval "elle tartı" sheet'inde de duruyordu.
  const numpad = useOptionalNumpadContext();
  // KARARLI referanslara ayrıştır — bağımlılık dizilerine `numpad` NESNESİNİ
  // koyma: context value'sunun kimliği `target` her değiştiğinde yenilenir,
  // dolayısıyla efekt kendini tetikler. Provider bu ikisini `useCallback([])`
  // ile stabil veriyor; yokken modül sabiti no-op'lara düşülür.
  const notifyChange = numpad?.notifyChange ?? NOOP_NOTIFY;
  const openTarget = numpad?.openTarget ?? NOOP_OPEN;
  const target = numpad?.target ?? null;

  // FAIL-SOFT: provider yoksa büyük numpad ZATEN çizilemez (host da yok) →
  // sistem klavyesine düş. Operatör metrajı yine girer; ekran ölmez. Bu, modal
  // yazarken `useNativeKeyboard` bayrağını koymayı unutmayı da AFFEDER — bayrak
  // hâlâ anlamlı (telefonda bilinçli tercih) ama artık tek savunma hattı değil.
  const nativeMode = useNativeKeyboard || numpad === null;

  const id = useId();
  const isActive = target?.id === id;

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChangeText);
  onChangeRef.current = onChangeText;

  useEffect(() => {
    notifyChange(id);
  }, [value, notifyChange, id]);

  const handleFocus = useCallback(() => {
    if (nativeMode) return;
    openTarget({
      id,
      label: numpadLabel,
      allowDecimal,
      maxLength: numpadMaxLength,
      getValue: () => valueRef.current,
      onChange: (next) => onChangeRef.current(next),
    });
  }, [openTarget, nativeMode, id, numpadLabel, allowDecimal, numpadMaxLength]);

  // autoActivate: mount edildiğinde + props değiştiğinde numpad'i bu input'a
  // bağla. Kullanıcı input'a dokunmadan tuşlara basabilir.
  useEffect(() => {
    if (autoActivate && !nativeMode) handleFocus();
  }, [autoActivate, handleFocus, nativeMode]);

  // Native klavye modu: iOS/Android decimal-pad açılır. Karakter filtresiyle
  // harf/sembol girişini engelle (Android'in numeric kbd'si bazı semboller
  // gösterir).
  const handleNativeChange = useCallback(
    (text: string) => {
      // Türkçe decimal-pad ondalık ayırıcı olarak VİRGÜL gösteriyor; sistem
      // yalnız NOKTA kabul ediyor → virgülü noktaya çevir (silme!). Aksi halde
      // "40,5" yazınca virgül düşüp "405" oluyordu.
      const normalized = text.replace(',', '.');
      const cleaned = allowDecimal
        ? normalized.replace(/[^0-9.]/g, '').replace(/(\..*)\..*/, '$1')
        : normalized.replace(/\D/g, '');
      if (numpadMaxLength !== undefined && cleaned.length > numpadMaxLength) return;
      onChangeText(cleaned);
    },
    [allowDecimal, numpadMaxLength, onChangeText]
  );

  if (nativeMode) {
    return (
      <TextInput
        {...rest}
        ref={ref as React.ComponentProps<typeof TextInput>['ref']}
        value={value}
        onChangeText={handleNativeChange}
        keyboardType={allowDecimal ? 'decimal-pad' : 'number-pad'}
        maxLength={numpadMaxLength}
      />
    );
  }

  return (
    <TextInput
      {...rest}
      ref={ref as React.ComponentProps<typeof TextInput>['ref']}
      value={value}
      onChangeText={onChangeText}
      onFocus={handleFocus}
      showSoftInputOnFocus={false}
      // Aktif görünüm native focus yerine numpad target'ına bağlı —
      // iOS native focus zaman aşımına uğrasa bile indigo outline kalır
      outlineColor={isActive ? ACTIVE_COLOR : (rest.outlineColor as string | undefined)}
      activeOutlineColor={
        isActive ? ACTIVE_COLOR : (rest.activeOutlineColor as string | undefined)
      }
    />
  );
});

export default NumpadInput;
