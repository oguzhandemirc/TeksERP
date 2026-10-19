// =============================================================================
// Bekçi: onaysız cihazda yalnız kullanıcı adı + parola girişi (device.unpairedPasswordLogin, 2026-10-19)
// =============================================================================
// NEGATİF SONDA (ölçüldü): gönderimde `trimmed` yerine ham ad → §2 KIRMIZI; `initialUsername` yok
// sayılınca → §3 KIRMIZI; gönderim sürerken kapı (`!submitting`) kalkınca → §4 KIRMIZI; LoginScreen'de liste sorgusu `!unpairedOnly` kapısı kalkınca → §6 KIRMIZI.
// =============================================================================
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithPaper } from '../../test/render';
import UnpairedPasswordForm from './UnpairedPasswordForm';

function setup(props: Partial<React.ComponentProps<typeof UnpairedPasswordForm>> = {}) {
  const onSubmit = jest.fn();
  const view = renderWithPaper(<UnpairedPasswordForm submitting={false} error="" onSubmit={onSubmit} {...props} />);
  return { onSubmit, view };
}

describe('UnpairedPasswordForm', () => {
  it('§1 boşken gönderilmez (düğme kapalı)', () => {
    const { onSubmit } = setup();
    fireEvent.press(screen.getByTestId('onaysiz-giris-yap'));
    fireEvent.changeText(screen.getByTestId('onaysiz-kullanici-adi'), 'ali');
    fireEvent.press(screen.getByTestId('onaysiz-giris-yap'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('onaysiz-giris-yap')).toBeDisabled();
  });

  it('§2 dolu form kırpılmış kullanıcı adı + ham parolayla gönderilir, parola temizlenir', () => {
    const { onSubmit } = setup();
    fireEvent.changeText(screen.getByTestId('onaysiz-kullanici-adi'), '  ali.veli  ');
    fireEvent.changeText(screen.getByTestId('onaysiz-parola'), ' s3cr3t_X ');
    fireEvent.press(screen.getByTestId('onaysiz-giris-yap'));
    expect(onSubmit).toHaveBeenCalledWith('ali.veli', ' s3cr3t_X ');
    expect(screen.getByTestId('onaysiz-parola').props.value).toBe('');
  });

  it('§3 kilit kipinde kullanıcı adı önden dolu; yalnız parola yeter', () => {
    const { onSubmit } = setup({ initialUsername: 'operator1' });
    expect(screen.getByTestId('onaysiz-kullanici-adi').props.value).toBe('operator1');
    fireEvent.changeText(screen.getByTestId('onaysiz-parola'), 'pw');
    fireEvent(screen.getByTestId('onaysiz-parola'), 'submitEditing');
    expect(onSubmit).toHaveBeenCalledWith('operator1', 'pw');
  });

  it('§4 gönderim sürerken ikinci gönderim yok', () => {
    const { onSubmit, view } = setup({ initialUsername: 'ali' });
    fireEvent.changeText(screen.getByTestId('onaysiz-parola'), 'pw');
    // Alan doluyken gönderim başlar (üst bileşen submitting=true verir); ikinci basış yutulmalı.
    view.rerender(<UnpairedPasswordForm initialUsername="ali" submitting error="" onSubmit={onSubmit} />);
    fireEvent.press(screen.getByTestId('onaysiz-giris-yap'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Giriş yapılıyor…')).toBeOnTheScreen();
  });

  it('§5 hata metni görünür; PIN/kart/personel listesi seçeneği çizilmez', () => {
    setup({ error: 'Kullanıcı adı veya parola hatalı' });
    expect(screen.getByTestId('onaysiz-hata')).toHaveTextContent('Kullanıcı adı veya parola hatalı');
    expect(screen.queryByText(/Hızlı PIN$/)).toBeNull();
    expect(screen.queryByText('Kullanıcı Seç')).toBeNull();
    expect(screen.queryByText(/Diğer giriş yöntemlerini dene/)).toBeNull();
  });
});

describe('§6 LoginScreen bağlantısı (kaynak bekçisi)', () => {
  const src = readFileSync(join(__dirname, 'LoginScreen.tsx'), 'utf8');
  it('işaret yalnız `=== true` ile okunur (eski backend → bugünkü ekran)', () => {
    expect(src).toMatch(/const unpairedOnly = methodsQ\.data\?\.unpairedPasswordOnly === true;/);
  });
  it('onaysız cihazda personel listesi istenmez', () => {
    expect(src).toMatch(/enabled: enabledMethods\.includes\('list'\) && !unpairedOnly,/);
  });
  it('onaysız formda kullanıcı adı gerçek ad diye kaydedilmez; ad giriş cevabından gelir', () => {
    expect(src).toContain("void submit(password, { id: '', username, fullName: '' })");
    expect(src).toContain('const name = user.fullName || res.data.user.fullName;');
  });
  it('form kart/PIN/liste dallarından ÖNCE seçilir', () => {
    const dal = src.indexOf(') : unpairedOnly ? (');
    expect(dal).toBeGreaterThan(-1);
    expect(src.indexOf(") : activeMethod === 'card' ? (")).toBeGreaterThan(dal);
  });
});
