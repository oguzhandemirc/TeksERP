// =============================================================================
// Bekçi: SimplePortal — paper `Portal`ın Fabric çökmesinden çıkışın sözleşmesi
// =============================================================================
// İki saha dersi, iki ayrı kilit:
// • 2026-08-15 #1 (2.7.1): paper `Portal` Fabric'te `Maximum update depth
//   exceeded` ile çöktü → taşıyıcı SimplePortal oldu (tek yönlü veri akışı).
// • 2026-08-15 #2 (2.7.2): tek yönlü akış YETMEDİ — senkron `emit`, tüketicinin
//   passive-effect fazı içinde host commit'ini zorluyor ve Fabric'in commit-içi
//   SENKRON layout olayları (FlashList ölçümü, skeleton→hata takası) aynı
//   "nested update" patlamasına zincirlenip 50 sınırında yine çökertiyordu.
//   Düzeltme: bildirim mikrotask'a ERTELENİR ve birleştirilir. §3d bu sözleşmenin
//   doğrudan regresyon kilididir.
//
// Bu dosyanın kilitleri:
//   §1  register / update / unregister (içerik host'ta doğar, güncellenir, ölür)
//   §2  sıralama: sonra mount olan ÜSTTE (modal üstüne modal — paper davranışı)
//   §3  host güncellemesi tüketiciyi YENİDEN ÇİZMEZ (tek yönlü akışın ölçümü)
//   §3c tüketici store'a ABONE OLMAZ (yapısal kilit — §3'ün göremediği yol)
//   §3d ⚠️ `set`/`remove` dinleyiciyi SENKRON ÇAĞIRMAZ; bildirim mikrotaskta
//       gelir ve peş peşe yazımlar TEK bildirimde birleşir. Bu satır gevşerse
//       2.7.2'nin saha çökmesi (commit-içi zincirlenme) geri gelir.
//   §3e geri-besleme STORE katında sonsuz SENKRON zincir kuramaz — her bildirim
//       kendi mikrotask turunda koşar. (Eski React-ağacı sondası kaldırıldı:
//       erteleme, geri-beslemeyi "senkron çökme"den "asenkron spin"e çevirdiği
//       için o sonda artık fırlatmaz, test ortamında da güvenle koşturulamaz —
//       çalışma zamanı kanaryası (1 sn'de 120+ bildirim → console.warn) ve §3c
//       o sınıfı kapatır.)
//   §4  `getSnapshot` referans kararlılığı (uSES sözleşmesi)
//   §5  KAPSAM: en yakın host kazanır (kilit katmanının modalı kök host'a düşmez)
// =============================================================================

import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { act, render } from '@testing-library/react-native';

import {
  SimplePortal,
  SimplePortalHost,
  SimplePortalScope,
  simplePortalStore,
} from './SimplePortal';

/** Ertelenmiş portal bildirimini (mikrotask) React içinde akıt. */
const flushPortals = () =>
  act(async () => {
    await Promise.resolve();
  });

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

beforeEach(async () => {
  // Önceki testin ağacı RNTL tarafından zaten sökülmüş olur (dinleyici yok) →
  // emit güvenli. Anahtar sayacı da sıfırlanır, sıralama kontrolü deterministik.
  simplePortalStore.__resetForTests();
  // Reset'in ertelenmiş bildirimi bir sonraki teste sarkmasın.
  await Promise.resolve();
});

describe('SimplePortal — kayıt yaşam döngüsü', () => {
  it('mount → içerik HOST ağacında çizilir, tüketicinin yerinde DEĞİL', async () => {
    const { getByTestId, toJSON } = render(
      <View testID="ekran">
        <SimplePortal>
          <Text testID="modal-icerik">Merhaba</Text>
        </SimplePortal>
        <SimplePortalHost />
      </View>,
    );
    await flushPortals();

    expect(getByTestId('modal-icerik')).toBeTruthy();
    // Tüketici `null` render eder: içerik host'un katmanında durur, yani
    // ekran düğümünün ilk çocuğu olarak DEĞİL en sonda gelir.
    const ids = testIdsInOrder(toJSON());
    expect(ids).toEqual(['ekran', 'modal-icerik']);
  });

  it('içerik değişince host TAZELENİR (update)', async () => {
    const Screen = ({ label }: { label: string }) => (
      <View>
        <SimplePortal>
          <Text testID="icerik">{label}</Text>
        </SimplePortal>
        <SimplePortalHost />
      </View>
    );
    const { getByTestId, rerender } = render(<Screen label="ilk" />);
    await flushPortals();
    expect(getByTestId('icerik').props.children).toBe('ilk');

    rerender(<Screen label="ikinci" />);
    await flushPortals();
    expect(getByTestId('icerik').props.children).toBe('ikinci');
  });

  it('unmount → kayıt SİLİNİR, host boşalır', async () => {
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
    await flushPortals();
    expect(queryByTestId('icerik')).toBeTruthy();

    rerender(<Screen open={false} />);
    // Kayıt store'dan SENKRON düşer (yalnız bildirim ertelenir).
    expect(simplePortalStore.getSnapshot()).toHaveLength(0);
    await flushPortals();
    expect(queryByTestId('icerik')).toBeNull();
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
  it('iki portal mount sırasına göre dizilir', async () => {
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
    await flushPortals();
    const ids = testIdsInOrder(toJSON());
    expect(ids.indexOf('alt')).toBeLessThan(ids.indexOf('ust'));
  });

  it('içerik güncellemesi sırayı DEĞİŞTİRMEZ (yeniden kayıt sona atmaz)', async () => {
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
    await flushPortals();
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

  it("kapsam içindeki portal KÖK host'a DÜŞMEZ, kapsamın katmanında çizilir", async () => {
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
    await flushPortals();

    expect(getByTestId('kilit-modali')).toBeTruthy();
    // Kök store'a HİÇ yazılmamalı — yazılsaydı içerik kilit katmanının altında
    // ikinci kez çizilirdi.
    expect(simplePortalStore.getSnapshot()).toHaveLength(0);
    // Ve ağaçta kilit katmanının İÇİNDE (yani kök host'tan SONRA) durmalı.
    const ids = testIdsInOrder(toJSON());
    expect(ids.indexOf('kilit-katmani')).toBeLessThan(ids.indexOf('kilit-modali'));
  });

  it("kapsam DIŞINDAKİ portal kök host'ta kalır (iki katman karışmaz)", async () => {
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
    await flushPortals();

    expect(getByTestId('ekran-modali')).toBeTruthy();
    expect(getByTestId('kilit-modali')).toBeTruthy();
    expect(simplePortalStore.getSnapshot()).toHaveLength(1); // yalnız ekran modalı
  });

  it("kapsam store'u KARARLI: yeniden render modal içeriğini SÖKÜP KURMAZ", async () => {
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
    await flushPortals();
    expect(mountSayisi).toBe(1);

    rerender(<Agac />);
    rerender(<Agac />);
    await flushPortals();
    expect(getByTestId('icerik')).toBeTruthy();
    expect(mountSayisi).toBe(1); // ⚠️ tek mount — kayıt sökülüp kurulmadı
  });
});

describe('SimplePortal — döngü güvenliği (asıl bekçi)', () => {
  // Store'a doğrudan yazmak için ayrılmış anahtar: otomatik sayaçla çakışmasın.
  const DIS_ANAHTAR = 1_000_000;

  it('§3 host güncellemesi tüketiciyi YENİDEN ÇİZMEZ', async () => {
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
    await flushPortals();

    const baslangic = guvenliRender;

    // Host'u DIŞARIDAN güncelle: tüketicinin React ağacına hiç dokunulmuyor.
    simplePortalStore.set(DIS_ANAHTAR, <Text testID="disaridan">dış</Text>);
    await flushPortals();

    expect(getByTestId('disaridan')).toBeTruthy(); // host gerçekten güncellendi
    expect(guvenliRender).toBe(baslangic); // ⚠️ döngünün kırıldığı yer

    simplePortalStore.remove(DIS_ANAHTAR);
    await flushPortals();
    expect(guvenliRender).toBe(baslangic);
  });

  it('§3c tüketici store\'a ABONE OLMAZ (yapısal kilit — §3 sayacının göremediği yol)', () => {
    // NEDEN AYRI BİR KONTROL: §3 tüketicinin EBEVEYN render'ını sayar. `SimplePortal`
    // bileşeninin KENDİSİNE abonelik eklenirse ebeveyn hiç yeniden çizilmez ve §3
    // yeşil kalır (negatif sondayla ölçüldü). Erteleme sonrası bu yol çökme değil
    // SONSUZ ASENKRON SPİN üretir (kanarya logcat'te bağırır) — yani hâlâ hatadır
    // ve kapısı yapısal olarak kilitli kalmalıdır.
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

  it('§3d `set`/`remove` dinleyiciyi SENKRON ÇAĞIRMAZ; bildirim mikrotaskta ve BİRLEŞİK gelir', async () => {
    // ⚠️ 2.7.2 SAHA ÇÖKMESİNİN DOĞRUDAN REGRESYON KİLİDİ. Bildirim `set`in
    // çağrıldığı senkron işin (React passive-effect fazı) içinde koşarsa, host
    // commit'i ve Fabric'in commit-içi layout çalkantısı aynı "nested update"
    // patlamasına zincirlenir ve React 50 sınırında uygulamayı düşürür
    // (logcat: `emit → forceStoreRerender → getRootForUpdatedFiber`).
    const dinleyici = jest.fn();
    const un = simplePortalStore.subscribe(dinleyici);
    try {
      simplePortalStore.set(DIS_ANAHTAR, null);
      simplePortalStore.set(DIS_ANAHTAR, <Text>x</Text>);
      simplePortalStore.remove(DIS_ANAHTAR);
      // Senkron faz bitti — hiçbir dinleyici ÇAĞRILMAMIŞ olmalı.
      expect(dinleyici).not.toHaveBeenCalled();
      // Snapshot yine de SENKRON günceldir (yalnız bildirim ertelenir).
      expect(simplePortalStore.getSnapshot()).toHaveLength(0);

      await Promise.resolve(); // mikrotask turu
      // Üç mutasyon TEK bildirimde birleşti (dinleyici en son durumu okur).
      expect(dinleyici).toHaveBeenCalledTimes(1);
    } finally {
      un();
    }
  });

  it('§3e geri-besleme SENKRON zincir kuramaz — her bildirim kendi mikrotask turunda', async () => {
    // Kasıtlı geri-besleme: dinleyici her bildirimde store'a TEKRAR yazar.
    // Eski (senkron) emit'te bu, tek senkron yığında 5 iç içe bildirim olurdu —
    // tam da React sayacını dolduran desen. Ertelemeyle her yazım bir SONRAKİ
    // mikrotask turunda bildirilir: senkron derinlik hep 1 kalır.
    let tur = 0;
    const un = simplePortalStore.subscribe(() => {
      tur++;
      if (tur < 5) simplePortalStore.set(DIS_ANAHTAR, tur);
    });
    try {
      simplePortalStore.set(DIS_ANAHTAR, 0);
      expect(tur).toBe(0); // senkron hiçbir şey koşmadı
      for (let i = 0; i < 10 && tur < 5; i++) await Promise.resolve();
      expect(tur).toBe(5); // besleme ilerledi ama tur tur — patlama yok
    } finally {
      un();
      simplePortalStore.remove(DIS_ANAHTAR);
      await Promise.resolve();
    }
  });

  it('§4 getSnapshot referans KARARLI (mutasyon yoksa aynı dizi)', async () => {
    // useSyncExternalStore sözleşmesi: her çağrıda yeni dizi → React "snapshot
    // değişti" der ve sonsuz döngüye girer (tam da kaçılan çökme sınıfı).
    const a = simplePortalStore.getSnapshot();
    expect(simplePortalStore.getSnapshot()).toBe(a);

    simplePortalStore.set(DIS_ANAHTAR, <Text>x</Text>);
    const b = simplePortalStore.getSnapshot();
    expect(b).not.toBe(a);
    expect(simplePortalStore.getSnapshot()).toBe(b);

    // Aynı içeriğin tekrar yazılması boş güncelleme üretmez (referans korunur).
    const ayniIcerik = b[0].children;
    simplePortalStore.set(DIS_ANAHTAR, ayniIcerik);
    expect(simplePortalStore.getSnapshot()).toBe(b);

    // Olmayan kaydı silmek de boş güncelleme üretmez.
    simplePortalStore.remove(DIS_ANAHTAR + 1);
    expect(simplePortalStore.getSnapshot()).toBe(b);

    simplePortalStore.remove(DIS_ANAHTAR);
    expect(simplePortalStore.getSnapshot()).toHaveLength(0);
    await Promise.resolve(); // sarkan bildirim bu testte ölsün
  });

  it('dinleyici, bildirim SIRASINDA çıkabilir (unmount) — iterasyon patlamaz', async () => {
    const gorulen: string[] = [];
    const un1 = simplePortalStore.subscribe(() => {
      gorulen.push('bir');
      un1(); // kendini bildirim ortasında çıkarır
    });
    const un2 = simplePortalStore.subscribe(() => gorulen.push('iki'));

    expect(() => simplePortalStore.set(DIS_ANAHTAR, null)).not.toThrow();
    await Promise.resolve();
    expect(gorulen).toEqual(['bir', 'iki']);

    un2();
    simplePortalStore.remove(DIS_ANAHTAR);
    await Promise.resolve();
  });
});
