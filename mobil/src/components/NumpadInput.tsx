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
  /** Odak (native klavye) ya da numpad hedefi bu kutuya geçti/çıktı — çağıran çerçevesini vurgular. */
  onFocusChange?: (focused: boolean) => void;
}

const ACTIVE_COLOR = '#4f46e5';

// ⚠️ MODÜL SEVİYESİNDE sabit — provider yokken kullanılan no-op'lar. Bileşen
// içinde `() => {}` yazmak KİMLİĞİ her render'da değiştirir ve aşağıdaki
// useEffect/useCallback bağımlılıklarını sürekli tetikler (2026-08-04'te tam
// bunu yapıp "Maximum update depth exceeded" sonsuz döngüsü ürettim).
const NOOP_NOTIFY = (_id: string) => {};
const NOOP_OPEN = (_target: NumpadTarget) => {};

/** Dış (forwardRef) ref'i iç ref'le birleştirir: iç ref odağı bırakmak için, dış ref çağırana iletilir. */
function useMergedRef(forwardedRef: React.ForwardedRef<RNTextInput>) {
  const innerRef = useRef<RNTextInput | null>(null);
  const ref = useCallback(
    (node: RNTextInput | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef]
  );
  return { innerRef, ref };
}

/** Odak bildirimi: numpad kipinde "odak" = numpad hedefi bu kutu; native kipte onFocus/onBlur `focusRef`i çağırır. */
function useFocusReport(onFocusChange: ((focused: boolean) => void) | undefined, isActive: boolean, nativeMode: boolean) {
  const focusRef = useRef(onFocusChange);
  focusRef.current = onFocusChange;
  useEffect(() => {
    if (!nativeMode) focusRef.current?.(isActive);
  }, [isActive, nativeMode]);
  return focusRef;
}

// Tuş takımı (Tamam / dış dokunuş) kapanınca TextInput native odağı koruyordu → aynı kutuya ikinci dokunuşta
// onFocus tetiklenmiyor, tuş takımı açılmıyordu (GK 2026-11-11). Hedef bu kutudan düşünce odağı bırak.
function useBlurOnRelease(innerRef: React.RefObject<RNTextInput | null>, isActive: boolean, nativeMode: boolean) {
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (wasActiveRef.current && !isActive && !nativeMode) innerRef.current?.blur?.();
    wasActiveRef.current = isActive;
  }, [innerRef, isActive, nativeMode]);
}

/**
 * Native klavye girdisini süzer. Türkçe decimal-pad ondalık ayırıcı olarak VİRGÜL gösteriyor; sistem
 * yalnız NOKTA kabul ediyor → virgülü noktaya çevir (silme!). Aksi halde "40,5" yazınca virgül düşüp "405" oluyordu.
 */
function cleanNumericText(text: string, allowDecimal: boolean): string {
  const normalized = text.replace(',', '.');
  return allowDecimal
    ? normalized.replace(/[^0-9.]/g, '').replace(/(\..*)\..*/, '$1')
    : normalized.replace(/\D/g, '');
}

/** Numpad'i bu kutuya bağlayan odak işleyicisi; değer/işleyici ref'ten okunur (kimlik değişimi hedefi yenilemez). */
function useOpenTarget(
  openTarget: (t: NumpadTarget) => void,
  nativeMode: boolean,
  t: { id: string; label?: string; allowDecimal: boolean; maxLength?: number; value: string; onChangeText: (next: string) => void },
) {
  const { id, label, allowDecimal, maxLength } = t;
  const valueRef = useRef(t.value);
  valueRef.current = t.value;
  const onChangeRef = useRef(t.onChangeText);
  onChangeRef.current = t.onChangeText;
  return useCallback(() => {
    if (nativeMode) return;
    openTarget({
      id,
      label,
      allowDecimal,
      maxLength,
      getValue: () => valueRef.current,
      onChange: (next) => onChangeRef.current(next),
    });
  }, [openTarget, nativeMode, id, label, allowDecimal, maxLength]);
}

const NumpadInput = forwardRef<RNTextInput, NumpadInputProps>(function NumpadInput(
  {
    value,
    onChangeText,
    numpadLabel,
    allowDecimal = true,
    numpadMaxLength,
    autoActivate = false,
    useNativeKeyboard = false,
    onFocusChange,
    ...rest
  },
  forwardedRef
) {
  // İç ref: tuş takımı kapanınca native odağı bırakmak için (aşağıda); dış ref'e de iletilir.
  const { innerRef, ref } = useMergedRef(forwardedRef);

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
  // Aynı felsefe: host ölçülüp okunur numpad için fazla kısa bulunduysa
  // (`NUMPAD_HOST_MIN_HEIGHT`) tuşlar görünmez → yine sistem klavyesi.
  const nativeMode = useNativeKeyboard || numpad === null || numpad.hostTooSmall;

  const id = useId();
  const isActive = target?.id === id;

  const focusRef = useFocusReport(onFocusChange, isActive, nativeMode);

  useEffect(() => {
    notifyChange(id);
  }, [value, notifyChange, id]);

  const handleFocus = useOpenTarget(openTarget, nativeMode, {
    id, label: numpadLabel, allowDecimal, maxLength: numpadMaxLength, value, onChangeText,
  });

  useBlurOnRelease(innerRef, isActive, nativeMode);

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
      const cleaned = cleanNumericText(text, allowDecimal);
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
        onFocus={() => focusRef.current?.(true)}
        onBlur={(e) => { focusRef.current?.(false); rest.onBlur?.(e); }}
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
      // İkinci savunma: odak zaten bizdeyse onFocus gelmez; her basış hedefi (yeniden) açar. openTarget idempotent.
      onPressIn={(e) => {
        handleFocus();
        rest.onPressIn?.(e);
      }}
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
