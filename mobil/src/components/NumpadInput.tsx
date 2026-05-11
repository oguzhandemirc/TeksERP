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
}

const ACTIVE_COLOR = '#4f46e5';

const NumpadInput = forwardRef<RNTextInput, NumpadInputProps>(function NumpadInput(
  { value, onChangeText, numpadLabel, allowDecimal = true, numpadMaxLength, ...rest },
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
    openTarget({
      id,
      label: numpadLabel,
      allowDecimal,
      maxLength: numpadMaxLength,
      getValue: () => valueRef.current,
      onChange: (next) => onChangeRef.current(next),
    });
  }, [openTarget, id, numpadLabel, allowDecimal, numpadMaxLength]);

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
