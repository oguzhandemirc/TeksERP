// =============================================================================
// Bekçi: "Güncellemeleri denetle" düğmesi HİÇBİR DURUMDA ekrandan düşmez
// =============================================================================
// SAHA TARİFİ (2026-09-04): "güncellemeleri denetle diyince buton kayboluyor".
// İki ayrı sebebi vardı, ikisi de tek başına yeterliydi:
//
//   1) Aksiyon bloğu `isUpdatePending ? <Yenile/> : <Denetle/>` idi — paket
//      indiği ANDA denetle düğmesi ağaçtan DÜŞÜYOR, yerine başka bir düğme
//      geliyordu. Operatör için bu "buton kayboldu"dur.
//   2) Düğme `mode="outlined"` + `disabled` olduğunda Paper renk proplarını
//      YOK SAYIP MD3 AÇIK temanın silik gri tonlarına düşüyordu; koyu kartın
//      üstünde bu fiilen görünmezliktir.
//
// Bu dosya İKİSİNİ de ölçer: düğme her durumda AĞAÇTA, ve rengi her durumda
// KENDİ tonundan (şeffaf/gri değil).
// =============================================================================

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import type { ViewStyle } from 'react-native';

import { UpdateActions, type UpdateActionsProps } from './UpdateActions';
import { SETTINGS_COLORS } from './settingsUi';

const TEMEL: UpdateActionsProps = {
  etkin: true,
  denetleniyor: false,
  indiriliyor: false,
  uygulamaBekliyor: false,
  yeniVar: false,
  sonuc: null,
  sonDenetlemeSaati: null,
  bekleyenYazim: 0,
  yenileniyor: false,
  onDenetle: jest.fn(),
  onYenile: jest.fn(),
};

function ciz(over: Partial<UpdateActionsProps> = {}) {
  return render(
    <PaperProvider>
      <UpdateActions {...TEMEL} {...over} />
    </PaperProvider>,
  );
}

/** Düğmenin gerçekten çizilen arka plan rengi (Paper `Surface` stilinden). */
function arkaPlan(testID: string): string | undefined {
  const kap = screen.getByTestId(`${testID}-container`);
  const flat = (Array.isArray(kap.props.style)
    ? Object.assign({}, ...kap.props.style.flat(Infinity).filter(Boolean))
    : kap.props.style) as ViewStyle;
  return flat?.backgroundColor as string | undefined;
}

/**
 * Ekranın geçtiği HER durum. Düğme bunların hepsinde ağaçta olmalı — özellikle
 * `uygulamaBekliyor` (eski kurgunun düğmeyi düşürdüğü tam durum).
 */
const DURUMLAR: [string, Partial<UpdateActionsProps>][] = [
  ['boşta', {}],
  ['denetleniyor', { denetleniyor: true }],
  ['paket iniyor', { indiriliyor: true }],
  ['sunucuda yeni sürüm var', { yeniVar: true }],
  ['sonuç: güncel', { sonuc: { durum: 'guncel' } }],
  ['sonuç: indirildi', { sonuc: { durum: 'indirildi' } }],
  ['sonuç: hata', { sonuc: { durum: 'hata', mesaj: 'ağ yok' } }],
  ['UYGULANMAYI BEKLİYOR', { uygulamaBekliyor: true }],
  ['bekleyen kayıt varken uygulanmayı bekliyor', { uygulamaBekliyor: true, bekleyenYazim: 3 }],
  ['yenileme koşuyor', { uygulamaBekliyor: true, yenileniyor: true }],
  ['uzaktan güncelleme kapalı (dev)', { etkin: false }],
];

describe('UpdateActions — denetle düğmesi kaybolmaz', () => {
  it.each(DURUMLAR)('%s: düğme AĞAÇTA', (_ad, over) => {
    ciz(over);
    expect(screen.getByTestId('ota-denetle')).toBeTruthy();
  });

  it.each(DURUMLAR)('%s: düğmenin RENGİ var (şeffaf/görünmez değil)', (_ad, over) => {
    ciz(over);
    const bg = arkaPlan('ota-denetle');
    expect(bg).toBeTruthy();
    expect(bg).not.toBe('transparent');
    // MD3 açık temanın silik disabled tonuna DÜŞMEMELİ (eski hatanın imzası).
    expect(bg).not.toMatch(/^rgba\(28/);
  });

  it('paket beklerken "Şimdi yenile" EKLENİR — denetle düğmesinin YERİNE GEÇMEZ', () => {
    ciz({ uygulamaBekliyor: true });
    expect(screen.getByTestId('ota-yenile')).toBeTruthy();
    expect(screen.getByTestId('ota-denetle')).toBeTruthy();
  });

  it('boştayken "Şimdi yenile" YOK (gürültü yok)', () => {
    ciz();
    expect(screen.queryByTestId('ota-yenile')).toBeNull();
  });

  it('kurulum kapalıyken düğme SİLİK ama OKUNUR — ve sebebi yazılı', () => {
    ciz({ etkin: false });
    expect(arkaPlan('ota-denetle')).toBe(SETTINGS_COLORS.disabledBg);
    expect(screen.getByText(/geliştirme kurulumu/i)).toBeTruthy();
  });

  it('hata metni ÇÖZÜMÜ söyler (yalnız hata kodunu değil)', () => {
    // Fabrikada bu ekranı okuyan kişi "internet mi, fabrika ağı mı" ayrımını
    // bilmiyor; iki kanal ayrı olduğu için sorunun cevabı da farklı.
    ciz({ sonuc: { durum: 'hata', mesaj: 'ETIMEDOUT' } });
    expect(screen.getByText(/internete bağlı mı/i)).toBeTruthy();
  });

  it('meşgulken etiket ne olduğunu söyler', () => {
    ciz({ denetleniyor: true });
    expect(screen.getByText('Denetleniyor…')).toBeTruthy();
    ciz({ indiriliyor: true });
    expect(screen.getByText('İndiriliyor…')).toBeTruthy();
  });

  it('son denetleme saati boştayken görünür, meşgulken görünmez', () => {
    ciz({ sonDenetlemeSaati: '14:07', sonuc: { durum: 'guncel' } });
    expect(screen.getByText('Son denetleme: 14:07')).toBeTruthy();
    ciz({ sonDenetlemeSaati: '14:07', denetleniyor: true });
    expect(screen.queryByText('Son denetleme: 14:07')).toBeNull();
  });
});
