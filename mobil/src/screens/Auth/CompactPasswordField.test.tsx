// =============================================================================
// Bekçi: dar düzende (telefon / DİKEY tablet) harfli parola girilebilir (2026-11-17)
// =============================================================================
// Hata: dar düzen girdiyi rakama süzüyordu ve ABC geçişi yalnız yatay numpad'deydi → admin dikeyde
// giriş yapamıyordu. NEGATİF SONDA: ABC dalında `sanitizeAlphaInput` yerine `sanitizeNumericInput` →
// §2 KIRMIZI; geçiş düğmesi kaldırılınca → §1 KIRMIZI; LoginScreen dar düzende alanı kullanmayınca → §5 KIRMIZI.
// =============================================================================
import React, { createRef } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { TextInput } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithPaper } from '../../test/render';
import CompactPasswordField from './CompactPasswordField';

type Props = React.ComponentProps<typeof CompactPasswordField>;

function setup(over: Partial<Props> = {}) {
  const onChange = jest.fn();
  const onToggleKeyboard = jest.fn();
  const onSubmit = jest.fn();
  const props: Props = {
    value: '',
    maxLength: 32,
    alphaKeyboard: false,
    hasUser: true,
    submitting: false,
    hasError: false,
    inputRef: createRef<TextInput>(),
    onChange,
    onToggleKeyboard,
    onFocusRequest: jest.fn(),
    onSubmit,
    ...over,
  };
  renderWithPaper(<CompactPasswordField {...props} />);
  return { onChange, onToggleKeyboard, onSubmit };
}

describe('CompactPasswordField (dar düzen parola)', () => {
  it('§1 ABC geçiş düğmesi dar düzende görünür ve basılınca geçiş ister', () => {
    const { onToggleKeyboard } = setup();
    const toggle = screen.getByTestId('login-abc-toggle-compact');
    expect(toggle).toBeOnTheScreen();
    expect(toggle).toHaveTextContent('ABC');
    fireEvent.press(toggle);
    expect(onToggleKeyboard).toHaveBeenCalledTimes(1);
  });

  it('§2 ⭐ ABC açıkken harfli/işaretli parola SÜZÜLMEDEN iletilir, klavye harfli', () => {
    const { onChange } = setup({ alphaKeyboard: true });
    expect(screen.getByTestId('login-abc-toggle-compact')).toHaveTextContent('123');
    const input = screen.getByTestId('login-password-compact-input');
    expect(input.props.keyboardType).toBe('default');
    fireEvent.changeText(input, 'Adm_in!42');
    expect(onChange).toHaveBeenLastCalledWith('Adm_in!42');
  });

  it('§3 123 kipinde sayı klavyesi + rakam süzmesi korunur', () => {
    const { onChange } = setup({ alphaKeyboard: false });
    const input = screen.getByTestId('login-password-compact-input');
    expect(input.props.keyboardType).toBe('number-pad');
    fireEvent.changeText(input, '12a34');
    expect(onChange).toHaveBeenLastCalledWith('1234');
  });

  it('§4 klavye "done" gönderir; kullanıcı yokken giriş alanı çizilmez', () => {
    const { onSubmit } = setup({ alphaKeyboard: true, value: 'pw' });
    fireEvent(screen.getByTestId('login-password-compact-input'), 'submitEditing');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    screen.unmount();
    setup({ hasUser: false });
    expect(screen.queryByTestId('login-password-compact-input')).toBeNull();
  });
});

describe('§5 LoginScreen bağlantısı (kaynak bekçisi)', () => {
  const src = readFileSync(join(__dirname, 'LoginScreen.tsx'), 'utf8');
  it('dar düzen şifre bölümü CompactPasswordField kullanır ve geçişi bağlar', () => {
    const block = src.slice(src.indexOf('const pinSectionCompact = ('), src.indexOf('const alphaToggle ='));
    expect(block).toContain('<CompactPasswordField');
    expect(block).toContain('alphaKeyboard={alphaKeyboard}');
    expect(block).toContain('onToggleKeyboard={handleToggleKeyboard}');
    expect(block).not.toContain('handlePinChange');
  });
});
