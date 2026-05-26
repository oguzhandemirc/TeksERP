import React, { forwardRef, useCallback, useEffect, useId, useRef } from 'react';
import { TextInput as RNTextInput } from 'react-native';
import { TextInput } from 'react-native-paper';
import type { TextInputProps } from 'react-native-paper';
import { useNumpadContext } from './NumpadProvider';

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
  // Stable callbacks via destructure (her ikisi de provider'da useCallback([])'lı)
  const { openTarget, notifyChange, target } = useNumpadContext();
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
    if (useNativeKeyboard) return;
    openTarget({
      id,
      label: numpadLabel,
      allowDecimal,
      maxLength: numpadMaxLength,
      getValue: () => valueRef.current,
      onChange: (next) => onChangeRef.current(next),
    });
  }, [openTarget, id, numpadLabel, allowDecimal, numpadMaxLength, useNativeKeyboard]);

  // autoActivate: mount edildiğinde + props değiştiğinde numpad'i bu input'a
  // bağla. Kullanıcı input'a dokunmadan tuşlara basabilir.
  useEffect(() => {
    if (autoActivate && !useNativeKeyboard) handleFocus();
  }, [autoActivate, handleFocus, useNativeKeyboard]);

  // Native klavye modu: iOS/Android decimal-pad açılır. Karakter filtresiyle
  // harf/sembol girişini engelle (Android'in numeric kbd'si bazı semboller
  // gösterir).
  const handleNativeChange = useCallback(
    (text: string) => {
      const cleaned = allowDecimal
        ? text.replace(/[^0-9.]/g, '').replace(/(\..*)\..*/, '$1')
        : text.replace(/\D/g, '');
      if (numpadMaxLength !== undefined && cleaned.length > numpadMaxLength) return;
      onChangeText(cleaned);
    },
    [allowDecimal, numpadMaxLength, onChangeText]
  );

  if (useNativeKeyboard) {
    return (
      <TextInput
        {...rest}
        ref={ref as React.Ref<any>}
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
      ref={ref as React.Ref<any>}
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
