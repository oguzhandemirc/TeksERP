// =============================================================================
// BEKÇİ — AppModal (portal) içindeki DOLU metin kutusuna yazınca imleç kaybı.
//
// Saha (2026-09-04, Tambur → "Müşterideki kumaş adı"): dolu kutuya yazılan
// karakterler metnin BAŞINA ve TERS SIRADA gidiyordu; boş kutuda ya da içi
// silinip yazıldığında sorun yoktu.
//
// Bu dosya iki şeyi ölçer:
//   §1  PORTAL BAYAT PENCERESİ (hatanın motoru) — AppModal içeriği host ağacına
//       taşındığı ve bildirim mikrotask'a ertelendiği için, tuş vuruşundan sonraki
//       commit'te kutu HÂLÂ ESKİ `value`yu taşır. RN TextInput tam o commit'te
//       eski metni native'e geri iter (seçim vermeden) → Android imleci 0'a çöker.
//   §2  DÜZELTME — `ModalTextInput` taslağı portalın İÇİNDE tuttuğu için bayat
//       pencere doğmaz, native'e tek bir itiş bile gitmez, sıra korunur.
//   §3  MODELİN KÖRLÜK ZEMİNİ — aynı model boş kutuda hatayı ÜRETMEZ (sahadaki
//       "boşken sorun yok" gözlemi). Model her şeyi kırmızı yapan bir kalıp değil.
//
// Android tarafı `androidEditText.model.tsx`te birebir kodlanmıştır (jest'te
// native köprü yok; RNTL'in `changeText`i RN'in iç `_onChange`ini koşturmaz).
// =============================================================================
import React, { useState } from 'react';
import { View } from 'react-native';
import { act } from '@testing-library/react-native';

import AppModal from './AppModal';
import ModalTextInput from './ModalTextInput';
import { renderWithPaper } from '../test/render';
import {
  AndroidEditText,
  type AndroidEditTextHandle,
} from './androidEditText.model';

// `ModalTextInput` paper'ın TextInput'unu render eder; testte onun yerine Android
// modeli geçer (prop sözleşmesi aynı: value + onChangeText).
jest.mock('react-native-paper', () => {
  const actual = jest.requireActual('react-native-paper');
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    TextInput: require('./androidEditText.model').AndroidEditText,
  };
});

const handleRef: { current: AndroidEditTextHandle | null } = { current: null };

/** Kutu doğrudan dışarıdaki state'ten sürülüyor (bugünkü hatalı kalıp). */
function DirectlyControlled({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return (
    <AppModal visible onDismiss={() => {}}>
      <View>
        <AndroidEditText value={v} onChangeText={setV} handleRef={handleRef} />
      </View>
    </AppModal>
  );
}

/** Aynı kurulum, tek fark: kutu `ModalTextInput` üzerinden sürülüyor. */
function ViaModalTextInput({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return (
    <AppModal visible onDismiss={() => {}}>
      <View>
        {/* handleRef `...rest` ile modele geçer. */}
        <ModalTextInput
          value={v}
          onChangeText={setV}
          {...({ handleRef } as Record<string, unknown>)}
        />
      </View>
    </AppModal>
  );
}

/** Operatörün tuş tuş yazması — her tuş kendi commit'ini + mikrotaskını görür. */
async function tuslaYaz(metin: string) {
  for (const ch of metin) {
    await act(async () => {
      handleRef.current!.type(ch);
    });
  }
}

beforeEach(() => {
  handleRef.current = null;
});

describe('AppModal içindeki metin kutusu — imleç sözleşmesi', () => {
  it('§1 kök sebep — tuş vuruşunun commit`inde native`e ESKİ metin itilir', async () => {
    renderWithPaper(<DirectlyControlled initial="ABC" />);
    await act(async () => {});
    handleRef.current!.setCaret(0);

    // Tek tuş, mikrotask BEKLENMEDEN: host henüz tazelenmedi, kutunun prop'u bayat.
    act(() => {
      handleRef.current!.type('D');
    });
    // İşte hatanın motoru: kullanıcı 'ABCD' yazdı, RN native'e 'ABC' geri itti.
    expect(handleRef.current!.getPushes()).toEqual(['ABC']);
    expect(handleRef.current!.getCaret()).toBe(0); // imleç çöktü

    await act(async () => {}); // mikrotask → host tazelenir, ikinci itiş
    expect(handleRef.current!.getPushes()).toEqual(['ABC', 'DABC']);
    expect(handleRef.current!.getText()).toBe('DABC');
    expect(handleRef.current!.getCaret()).toBe(0); // hâlâ 0 → sıradaki harf BAŞA yazılır
  });

  it('§2a doğrudan kontrollü kutu — DOLU alana yazınca metin TERS ve BAŞA gider (hata)', async () => {
    renderWithPaper(<DirectlyControlled initial="ABC" />);
    await act(async () => {});
    // Dolu kutuya odaklanınca Android imleci başa alır (ReactEditText.kt ~l.233).
    handleRef.current!.setCaret(0);

    await tuslaYaz('DE');

    expect(handleRef.current!.getText()).toBe('EDABC'); // sahadaki şikâyet
    expect(handleRef.current!.getPushes().length).toBeGreaterThan(0);
  });

  it('§2b ModalTextInput — aynı senaryoda sıra DOĞRU, native`e tek itiş bile gitmez', async () => {
    renderWithPaper(<ViaModalTextInput initial="ABC" />);
    await act(async () => {});
    handleRef.current!.setCaret(0);

    await tuslaYaz('DE');

    expect(handleRef.current!.getText()).toBe('DEABC');
    expect(handleRef.current!.getCaret()).toBe(2); // imleç yazılanın ardında
    expect(handleRef.current!.getPushes()).toEqual([]);
  });

  it('§2c ModalTextInput — metnin ORTASINA yazmak da doğru sırada', async () => {
    renderWithPaper(<ViaModalTextInput initial="ABC" />);
    await act(async () => {});
    handleRef.current!.setCaret(1);

    await tuslaYaz('XY');

    expect(handleRef.current!.getText()).toBe('AXYBC');
  });

  it('§2d ModalTextInput — SONDAN yazmak (bugün de çalışan yol) bozulmadı', async () => {
    renderWithPaper(<ViaModalTextInput initial="ABC" />);
    await act(async () => {});
    handleRef.current!.setCaret(3);

    await tuslaYaz('DE');

    expect(handleRef.current!.getText()).toBe('ABCDE');
  });

  it('§3 körlük zemini — BOŞ kutu doğrudan kontrollüyken de bozulmaz (saha gözlemi)', async () => {
    renderWithPaper(<DirectlyControlled initial="" />);
    await act(async () => {});

    await tuslaYaz('ABC');

    // Model her senaryoyu kırmızı yapmıyor: hata yalnız DOLU kutuda doğuyor.
    expect(handleRef.current!.getText()).toBe('ABC');
  });

  // §5 — sahadan gelen İKİ yüzey (Tambur kesim ekranı + etiket önizleme sheet'i)
  // ön-doldurulmuş "müşterideki ad" kutusunu taşır; ikisi de portalın içindedir.
  // Çıplak `<TextInput` geri gelirse hata da geri gelir ve davranış testi bunu
  // görmez (o dosyaları render etmiyor) — bu yüzden yapısal kontrol.
  it('§5 ön-doldurulmuş "müşterideki ad" yüzeyleri çıplak TextInput kullanmaz', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const files = [
      'src/screens/Modules/Tambur/LabelNamePreview.tsx',
      'src/components/labels/LabelPreviewSheet.tsx',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
      expect({ rel, bare: /<TextInput[\s/>]/.test(src) }).toEqual({ rel, bare: false });
      expect({ rel, uses: src.includes('ModalTextInput') }).toEqual({ rel, uses: true });
    }
  });

  it('§4 dıştan ön-doldurma (modal açılışı) ModalTextInput`te de görünür', async () => {
    function Prefill() {
      const [v, setV] = useState('');
      return (
        <AppModal visible onDismiss={() => {}}>
          <View>
            <ModalTextInput
              value={v}
              onChangeText={setV}
              {...({ handleRef } as Record<string, unknown>)}
            />
            {/* Modal açılınca sunucudan gelen adı yazan effect'in karşılığı. */}
            <Prefiller onFill={() => setV('AKTOS')} />
          </View>
        </AppModal>
      );
    }
    function Prefiller({ onFill }: { onFill: () => void }) {
      React.useEffect(() => {
        onFill();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    }

    renderWithPaper(<Prefill />);
    await act(async () => {});
    expect(handleRef.current!.getText()).toBe('AKTOS');

    handleRef.current!.setCaret(5);
    await tuslaYaz('X');
    expect(handleRef.current!.getText()).toBe('AKTOSX');
  });
});
