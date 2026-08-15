// =============================================================================
// Bekçi: SimplePortal — paper `Portal`ın Fabric döngüsünden çıkışın sözleşmesi
// =============================================================================
// Saha çökmesi (2026-08-15, SM-X230): `Maximum update depth exceeded`; 14
// çökmenin 6'sı `Portal > ThemedComponent > AppModal` yığınında. AppModal artık
// paper `Portal` yerine `SimplePortal` kullanıyor. Bu dosya taşıyıcının BEŞ
// özelliğini kilitler:
//   1. register / update / unregister (içerik host'ta doğar, güncellenir, ölür)
//   2. sıralama: sonra mount olan ÜSTTE (modal üstüne modal — paper davranışı)
//   3. ⚠️ HOST GÜNCELLEMESİ TÜKETİCİYİ YENİDEN ÇİZMEZ — döngünün yapısal olarak
//      kurulamamasının sebebi budur. Tüketici store'a yalnız YAZAR; okumaz.
//      (§3 render sayacı + §3c "tüketici subscribe ÇAĞIRMAZ" yapısal kilidi —
//      ikincisi §3'ün göremediği yolu kapatır, bkz. oradaki gerekçe.)
//   4. `getSnapshot` referans kararlılığı — her çağrıda yeni dizi dönseydi
//      `useSyncExternalStore` tam da kaçılan sonsuz döngüye girerdi.
//   5. KAPSAM: en yakın host kazanır (kilit katmanının modalı kök host'a düşmez —
//      düşseydi kilit ekranının arkasında kalırdı; bkz. o bölümün başlığı).
//
// NEGATİF SONDA (§3b): store'a ABONE OLAN bir "geri-beslemeli" tüketici varyantı
// çizilir ve SAHA İMZASININ AYNISIYLA (`Maximum update depth exceeded`) patladığı
// doğrulanır. Yani §3'ün render sayacı kör değil: `SimplePortal`e store okuyan bir
// hook eklendiği gün bu sınıf geri gelir ve bekçi onu gösterir.
// =============================================================================

import React, { useEffect, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { act, cleanup, render } from '@testing-library/react-native';

import {
  SimplePortal,
  SimplePortalHost,
  SimplePortalScope,
  simplePortalStore,
} from './SimplePortal';

/** Ağaçtaki testID'leri render sırasıyla düz listeye çıkarır. */
function testIdsInOrder(json: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const n = node as { props?: Record<string, unknown>; children?: unknown };
    const id = n.props?.testID;
    if (typeof id === 'string') out.push(id);
    if (n.children) walk(n.children);
  };
  walk(json);
  return out;
}

beforeEach(() => {
  // Önceki testin ağacı RNTL tarafından zaten sökülmüş olur (dinleyici yok) →
  // emit güvenli. Anahtar sayacı da sıfırlanır, sıralama kontrolü deterministik.
  simplePortalStore.__resetForTests();
});

describe('SimplePortal — kayıt yaşam döngüsü', () => {
  it('mount → içerik HOST ağacında çizilir, tüketicinin yerinde DEĞİL', () => {
    const { getByTestId, toJSON } = render(
      <View testID="ekran">
        <SimplePortal>
          <Text testID="modal-icerik">Merhaba</Text>
        </SimplePortal>
        <SimplePortalHost />
      </View>,
    );

    expect(getByTestId('modal-icerik')).toBeTruthy();
    // Tüketici `null` render eder: içerik host'un katmanında durur, yani
    // ekran düğümünün ilk çocuğu olarak DEĞİL en sonda gelir.
    const ids = testIdsInOrder(toJSON());
    expect(ids).toEqual(['ekran', 'modal-icerik']);
  });

  it('içerik değişince host TAZELENİR (update)', () => {
    const Screen = ({ label }: { label: string }) => (
      <View>
        <SimplePortal>
          <Text testID="icerik">{label}</Text>
        </SimplePortal>
        <SimplePortalHost />
      </View>
    );
    const { getByTestId, rerender } = render(<Screen label="ilk" />);
    expect(getByTestId('icerik').props.children).toBe('ilk');

    rerender(<Screen label="ikinci" />);
    expect(getByTestId('icerik').props.children).toBe('ikinci');
  });

  it('unmount → kayıt SİLİNİR, host boşalır', () => {
    const Screen = ({ open }: { open: boolean }) => (
      <View>
        {open ? (
          <SimplePortal>
            <Text testID="icerik">x</Text>
          </SimplePortal>
        ) : null}
        <SimplePortalHost />
      </View>
    );
    const { queryByTestId, rerender } = render(<Screen open />);
    expect(queryByTestId('icerik')).toBeTruthy();

    rerender(<Screen open={false} />);
    expect(queryByTestId('icerik')).toBeNull();
    expect(simplePortalStore.getSnapshot()).toHaveLength(0);
  });

  it('host YOKSA içerik hiçbir yerde çizilmez (host zorunlu — paper sözleşmesi)', () => {
    const { queryByTestId } = render(
      <SimplePortal>
        <Text testID="icerik">x</Text>
      </SimplePortal>,
    );
    expect(queryByTestId('icerik')).toBeNull();
    // Kayıt yine de store'da durur: host sonradan mount olsa içerik belirir.
    expect(simplePortalStore.getSnapshot()).toHaveLength(1);
  });

  it('kayıt yokken host HİÇBİR ŞEY render etmez (ekranda sıfır ayak izi)', () => {
    const { toJSON } = render(<SimplePortalHost />);
    expect(toJSON()).toBeNull();
  });
});

describe('SimplePortal — sıralama (sonra mount olan ÜSTTE)', () => {
  it('iki portal mount sırasına göre dizilir', () => {
    const { toJSON } = render(
      <View>
        <SimplePortal>
          <Text testID="alt">alt</Text>
        </SimplePortal>
        <SimplePortal>
          <Text testID="ust">üst</Text>
        </SimplePortal>
        <SimplePortalHost />
      </View>,
    );
    const ids = testIdsInOrder(toJSON());
    expect(ids.indexOf('alt')).toBeLessThan(ids.indexOf('ust'));
  });

  it('içerik güncellemesi sırayı DEĞİŞTİRMEZ (yeniden kayıt sona atmaz)', () => {
    const Screen = ({ label }: { label: string }) => (
      <View>
        <SimplePortal>
          <Text testID="alt">{label}</Text>
        </SimplePortal>
        <SimplePortal>
          <Text testID="ust">üst</Text>
        </SimplePortal>
        <SimplePortalHost />
      </View>
    );
    const { rerender, toJSON } = render(<Screen label="ilk" />);
    rerender(<Screen label="ikinci" />);
    const ids = testIdsInOrder(toJSON());
    expect(ids.indexOf('alt')).toBeLessThan(ids.indexOf('ust'));
  });
});

describe('SimplePortal — kapsam (EN YAKIN host kazanır)', () => {
  // ⚠️ Bu bölümün saha karşılığı: kilitli ekranda açılan "sunucu adresi" sheet'i.
  // LockScreen → LoginScreen(lock) → ServerAddressSheet → AppModal zinciri, kilit
  // katmanının KENDİ portal katmanında çizilmek ZORUNDA; kök host'a düşerse kilit
  // ekranının ARKASINDA kalır ve yanlış IP girmiş operatör ayarlara ulaşamaz
  // (paper döneminde bunu ikinci PaperProvider'ın Portal.Host'u sağlıyordu).

  it("kapsam içindeki portal KÖK host'a DÜŞMEZ, kapsamın katmanında çizilir", () => {
    const { getByTestId, toJSON } = render(
      <View>
        <SimplePortalHost />
        <View testID="kilit-katmani">
          <SimplePortalScope>
            <SimplePortal>
              <Text testID="kilit-modali">sunucu adresi</Text>
            </SimplePortal>
          </SimplePortalScope>
        </View>
      </View>,
    );

    expect(getByTestId('kilit-modali')).toBeTruthy();
    // Kök store'a HİÇ yazılmamalı — yazılsaydı içerik kilit katmanının altında
    // ikinci kez çizilirdi.
    expect(simplePortalStore.getSnapshot()).toHaveLength(0);
    // Ve ağaçta kilit katmanının İÇİNDE (yani kök host'tan SONRA) durmalı.
    const ids = testIdsInOrder(toJSON());
    expect(ids.indexOf('kilit-katmani')).toBeLessThan(ids.indexOf('kilit-modali'));
  });

  it("kapsam DIŞINDAKİ portal kök host'ta kalır (iki katman karışmaz)", () => {
    const { getByTestId } = render(
      <View>
        <SimplePortal>
          <Text testID="ekran-modali">ekran</Text>
        </SimplePortal>
        <SimplePortalHost />
        <SimplePortalScope>
          <SimplePortal>
            <Text testID="kilit-modali">kilit</Text>
          </SimplePortal>
        </SimplePortalScope>
      </View>,
    );

    expect(getByTestId('ekran-modali')).toBeTruthy();
    expect(getByTestId('kilit-modali')).toBeTruthy();
    expect(simplePortalStore.getSnapshot()).toHaveLength(1); // yalnız ekran modalı
  });

  it("kapsam store'u KARARLI: yeniden render modal içeriğini SÖKÜP KURMAZ", () => {
    // Kapsam store'u her render'da yeniden kurulsaydı context yeni değer yayar,
    // `SimplePortal` yeni bir anahtar alır ve host'taki satır kimliği değişirdi →
    // modal içeriği unmount/remount olur (form/animasyon durumu sıfırlanır,
    // modal titrer). Mount sayacı bunu doğrudan ölçer.
    let mountSayisi = 0;
    const Icerik = () => {
      useEffect(() => {
        mountSayisi++;
      }, []);
      return <Text testID="icerik">x</Text>;
    };
    const Agac = () => (
      <SimplePortalScope>
        <SimplePortal>
          <Icerik />
        </SimplePortal>
      </SimplePortalScope>
    );

    const { rerender, getByTestId } = render(<Agac />);
    expect(mountSayisi).toBe(1);

    rerender(<Agac />);
    rerender(<Agac />);
    expect(getByTestId('icerik')).toBeTruthy();
    expect(mountSayisi).toBe(1); // ⚠️ tek mount — kayıt sökülüp kurulmadı
  });
});

describe('SimplePortal — döngü güvenliği (asıl bekçi)', () => {
  // Store'a doğrudan yazmak için ayrılmış anahtar: otomatik sayaçla çakışmasın.
  const DIS_ANAHTAR = 1_000_000;

  it('§3 host güncellemesi tüketiciyi YENİDEN ÇİZMEZ', () => {
    let guvenliRender = 0;

    // Gerçek sözleşme: store'a yalnız YAZAR, okumaz.
    function GuvenliTuketici() {
      guvenliRender++;
      return (
        <SimplePortal>
          <Text testID="guvenli">guvenli</Text>
        </SimplePortal>
      );
    }

    const { getByTestId } = render(
      <View>
        <GuvenliTuketici />
        <SimplePortalHost />
      </View>,
    );

    const baslangic = guvenliRender;

    // Host'u DIŞARIDAN güncelle: tüketicinin React ağacına hiç dokunulmuyor.
    act(() => {
      simplePortalStore.set(DIS_ANAHTAR, <Text testID="disaridan">dış</Text>);
    });

    expect(getByTestId('disaridan')).toBeTruthy(); // host gerçekten güncellendi
    expect(guvenliRender).toBe(baslangic); // ⚠️ döngünün kırıldığı yer

    act(() => {
      simplePortalStore.remove(DIS_ANAHTAR);
    });
    expect(guvenliRender).toBe(baslangic);
  });

  it('§3c tüketici store\'a ABONE OLMAZ (yapısal kilit — §3 sayacının göremediği yol)', () => {
    // NEDEN AYRI BİR KONTROL: §3 tüketicinin EBEVEYN render'ını sayar. `SimplePortal`
    // bileşeninin KENDİSİNE abonelik eklenirse ebeveyn hiç yeniden çizilmez ve §3
    // yeşil kalır (negatif sondayla ölçüldü). O hâlde ölümcül değildir — çünkü
    // `set`in `Object.is` erken dönüşü döngüyü keser — ama emniyet payı biter:
    // aynı anda `Object.is` de düşerse saha çökmesi geri gelir. Bu yüzden abonelik
    // doğrudan, yapısal olarak kilitlenir.
    const subSpy = jest.spyOn(simplePortalStore, 'subscribe');
    try {
      render(
        <SimplePortal>
          <Text testID="x">x</Text>
        </SimplePortal>,
      );
      expect(subSpy).not.toHaveBeenCalled(); // ⚠️ tüketici okumaz

      // Körlük zemini: host GERÇEKTEN abone oluyor — yani spy çalışıyor.
      render(<SimplePortalHost />);
      expect(subSpy).toHaveBeenCalled();
    } finally {
      subSpy.mockRestore();
    }
  });

  it('§3b NEGATİF SONDA: tüketiciye geri-besleme eklenirse SAHA ÇÖKMESİ aynen doğar', () => {
    // Bu test §3'ün kör olmadığını kanıtlar ve saha imzasını (`Maximum update
    // depth exceeded`) BİREBİR yeniden üretir. Zincir: tüketici store'u okur →
    // kendi kaydı emit eder → tüketici yeniden çizilir → effect yeni bir children
    // ELEMENTİ yazar (referans farklı) → emit → ... React 50 iç içe güncellemede
    // durdurur. paper `PortalConsumer`ın Fabric'te yaptığı da tam olarak budur.
    //
    // ⚠️ Bu yüzden `SimplePortal` içine store okuyan hiçbir hook eklenmemeli.
    function GeriBeslemeliTuketici() {
      useSyncExternalStore(
        simplePortalStore.subscribe,
        simplePortalStore.getSnapshot,
        simplePortalStore.getSnapshot,
      );
      return (
        <SimplePortal>
          <Text testID="geri-beslemeli">geri</Text>
        </SimplePortal>
      );
    }

    // React döngüyü console.error ile de bildirir — test çıktısını kirletmesin.
    const sessiz = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        render(
          <View>
            <GeriBeslemeliTuketici />
            <SimplePortalHost />
          </View>,
        ),
      ).toThrow(/Maximum update depth exceeded/);
    } finally {
      sessiz.mockRestore();
      cleanup(); // yarıda kalan ağacı sök → dinleyici sızmasın
    }
  });

  it('§4 getSnapshot referans KARARLI (mutasyon yoksa aynı dizi)', () => {
    // useSyncExternalStore sözleşmesi: her çağrıda yeni dizi → React "snapshot
    // değişti" der ve sonsuz döngüye girer (tam da kaçılan çökme sınıfı).
    const a = simplePortalStore.getSnapshot();
    expect(simplePortalStore.getSnapshot()).toBe(a);

    act(() => {
      simplePortalStore.set(DIS_ANAHTAR, <Text>x</Text>);
    });
    const b = simplePortalStore.getSnapshot();
    expect(b).not.toBe(a);
    expect(simplePortalStore.getSnapshot()).toBe(b);

    // Aynı içeriğin tekrar yazılması boş güncelleme üretmez (referans korunur).
    const ayniIcerik = b[0].children;
    act(() => {
      simplePortalStore.set(DIS_ANAHTAR, ayniIcerik);
    });
    expect(simplePortalStore.getSnapshot()).toBe(b);

    // Olmayan kaydı silmek de boş güncelleme üretmez.
    act(() => {
      simplePortalStore.remove(DIS_ANAHTAR + 1);
    });
    expect(simplePortalStore.getSnapshot()).toBe(b);

    act(() => {
      simplePortalStore.remove(DIS_ANAHTAR);
    });
    expect(simplePortalStore.getSnapshot()).toHaveLength(0);
  });

  it('dinleyici, emit SIRASINDA çıkabilir (unmount) — iterasyon patlamaz', () => {
    const gorulen: string[] = [];
    const un1 = simplePortalStore.subscribe(() => {
      gorulen.push('bir');
      un1(); // kendini emit ortasında çıkarır
    });
    const un2 = simplePortalStore.subscribe(() => gorulen.push('iki'));

    expect(() => simplePortalStore.set(DIS_ANAHTAR, null)).not.toThrow();
    expect(gorulen).toEqual(['bir', 'iki']);

    un2();
    simplePortalStore.remove(DIS_ANAHTAR);
  });
});
