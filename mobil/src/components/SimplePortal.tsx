import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

// =============================================================================
// SimplePortal — bağımlılıksız portal primitifi (react-native-paper `Portal`
// yerine). YENİ PAKET YOK: yalnız React + RN View.
//
// NEDEN VAR (2026-08-15 saha çökmesi, SM-X230): paper `Portal` içeriği
// `PortalConsumer` (class) → `PortalHost` → `PortalManager` (class, setState)
// zinciriyle taşır. Fabric'te bu zincir kendini besleyen bir güncelleme döngüsüne
// giriyor ve `Maximum update depth exceeded` ile uygulamayı düşürüyordu (14
// çökmenin 6'sı `Portal > ThemedComponent > AppModal` yığınında; paper
// #4754/#4807/#3395 ailesi). Tema sabit olduğu hâlde tekrarladı — yani sorun
// tüketicide değil, TAŞIYICIDA.
//
// DÖNGÜ-GÜVENLİĞİ İKİ AYAKLI — ikisi de zorunlu, biri 2.7.2'de sahada eksikti:
//   1. TEK YÖNLÜ VERİ AKIŞI: tüketici (`SimplePortal`) store'a yalnız YAZAR
//      (`useEffect` içinde), OKUMAZ, `null` render eder; host store'u
//      `useSyncExternalStore` ile yalnız OKUR. Bu, MANTIKSAL sonsuz döngüyü
//      (host → tüketici → host) keser.
//   2. ⚠️ BİLDİRİM COMMIT İÇİNDE KOŞMAZ — `emit` mikrotask'a ERTELENİR.
//      2.7.2 saha dersi (SM-X230, 4 çökme, hepsi `AppModal → SimplePortal`):
//      1. madde tek başına ÇÖKMEYİ ENGELLEMEZ, çünkü React'in "Maximum update
//      depth" sayacı fiber'e değil KESİNTİSİZ SENKRON PATLAMAYA bakar. Senkron
//      `emit`, tüketicinin passive-effect fazının İÇİNDE `forceStoreRerender` →
//      host commit'ini zorluyordu; Fabric layout olaylarını commit sırasında
//      SENKRON dağıttığı için modal içeriğinin yerleşme çalkantısı (FlashList
//      ölçümü, skeleton→hata görünümü takası, entering animasyonları) aynı
//      patlamaya ZİNCİRLENDİ ve sayaç 50'ye çarptı — logcat imzası:
//      `emit → forceStoreRerender → getRootForUpdatedFiber` (throw). Erteleme
//      bu zinciri fiziksel olarak koparır: bildirim her zaman BOŞ JS yığınında
//      başlar, her patlama kendi içerik çalkantısıyla sınırlı kalır ve sayaç
//      commit'ler arasında sıfırlanır. (Eski mimaride layout olayları asenkron
//      geldiği için paper `Portal` aynı ekranlarda yalnız ARALIKLI çökerdi —
//      "eski tablette intermittent" gözleminin açıklaması budur.)
// ⚠️ `SimplePortal` tarafına store'u OKUYAN bir hook (`useSyncExternalStore` /
// store verisi taşıyan context / zustand selector) eklenirse 1. ayak delinir ve
// erteleme çökmeyi değil yalnız biçimini değiştirir (senkron çökme yerine sonsuz
// asenkron spin). Aşağıdaki `useContext` bunun İSTİSNASI DEĞİL: context yalnız
// KARARLI store NESNESİNİ taşır (veriyi değil), yani hiçbir zaman değişmez ve
// re-render üretmez. Bekçi: `SimplePortal.test.tsx` (§3 sayaç, §3c yapısal,
// §3d senkron-bildirim sözleşmesi). Spin'e karşı çalışma zamanı kanaryası
// aşağıda (1 sn'de 120+ bildirim → console.warn, logcat'te görünür).
//
// HOST ZORUNLUDUR: host mount edilmemişse içerik hiçbir yerde çizilmez (paper'ın
// "Portal.Host olmadan çalışmaz" sözleşmesiyle aynı). Kökte App.tsx mount eder;
// bileşen testlerinde `src/test/render.tsx` sarmalayıcısı ekler.
//
// KAPSAM (SCOPE) — paper'ın "EN YAKIN Portal.Host kazanır" kuralının aynısı:
// varsayılan hedef KÖK store'dur, ama `SimplePortalScope` ile sarılan alt ağacın
// portalları o kapsamın kendi host'unda çizilir. Kilit katmanı (App.tsx'teki
// IdleLockGate) bunu KULLANIR ve kullanmak ZORUNDADIR: kilitliyken açılan
// "sunucu adresi" sheet'i (LoginScreen → ServerAddressSheet → AppModal) kök
// host'a düşseydi kilit ekranının ARKASINDA kalır, yanlış IP girmiş operatör
// ayarlara hiç ulaşamazdı. Paper döneminde bunu ikinci `PaperProvider`ın kendi
// `Portal.Host`u sağlıyordu.
//
// SIRALAMA: her kapsamın içinde sonra mount olan ÜSTTE (paper davranışının aynısı
// — modal üstüne modal). Anahtar kapsam başına monoton sayaçtan gelir, snapshot
// artan anahtara göre sıralanır.
// =============================================================================

export interface SimplePortalEntry {
  key: number;
  children: React.ReactNode;
}

type Listener = () => void;

export interface SimplePortalStore {
  createKey(): number;
  set(key: number, children: React.ReactNode): void;
  remove(key: number): void;
  subscribe(listener: Listener): () => void;
  getSnapshot(): SimplePortalEntry[];
  __resetForTests(): void;
}

export function createSimplePortalStore(): SimplePortalStore {
  // Kayıtlar: anahtar → içerik. Map insertion-ordered; yine de snapshot artan
  // anahtara göre sıralanır (sıra, güncelleme/yeniden kayıt sırasından bağımsız).
  const entries = new Map<number, React.ReactNode>();
  const listeners = new Set<Listener>();
  // useSyncExternalStore sözleşmesi: getSnapshot AYNI referansı dönmeli, yoksa
  // React sonsuz "snapshot değişti" döngüsüne girer — yani tam da kaçılan çökme
  // sınıfı. Bu yüzden snapshot yalnız gerçek mutasyonda yeniden kurulur.
  let snapshot: SimplePortalEntry[] = [];
  let nextKey = 1;

  const rebuild = () => {
    snapshot = Array.from(entries, ([key, children]) => ({ key, children })).sort(
      (a, b) => a.key - b.key,
    );
  };

  // ⚠️ BİLDİRİM ERTELENİR VE BİRLEŞTİRİLİR (yukarıdaki başlık, 2. ayak).
  // Mikrotask, mevcut senkron işin (render/commit/passive-effect) TAMAMI bitip
  // JS yığını boşaldıktan sonra, bir sonraki kare ÇİZİLMEDEN önce koşar — yani
  // içerik gecikmesi görünmez ama React'in iç içe güncelleme sayacı asla
  // store sınırından beslenmez. Peş peşe set/remove tek bildirimde birleşir
  // (map senkron güncel; dinleyici en son durumu okur).
  const scheduleNotify: (cb: () => void) => void =
    typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (cb) => {
          void Promise.resolve().then(cb);
        };
  let notifyScheduled = false;
  // Geri-besleme kanaryası: tek yönlü akış delinirse (tüketici store okumaya
  // başlarsa) erteleme çökmeyi sonsuz asenkron spin'e çevirir — sessiz kalmasın.
  let notifyWindowStart = 0;
  let notifyWindowCount = 0;
  const emit = () => {
    if (notifyScheduled) return;
    notifyScheduled = true;
    scheduleNotify(() => {
      notifyScheduled = false;
      const now = Date.now();
      if (now - notifyWindowStart > 1000) {
        notifyWindowStart = now;
        notifyWindowCount = 0;
      }
      if (++notifyWindowCount === 120) {
        console.warn(
          '[SimplePortal] 1 sn içinde 120+ host bildirimi — muhtemel geri-besleme; SimplePortal.tsx başlığını oku.',
        );
      }
      // Kopya üzerinde gez: dinleyici kendini çıkarırsa (unmount) Set mutasyonu
      // iterasyonu bozmasın.
      for (const l of Array.from(listeners)) l();
    });
  };

  return {
    /** Yeni portal anahtarı (kapsam başına monoton sayaç). */
    createKey: () => nextKey++,
    /** Kayıt/güncelleme. Aynı içerik tekrar yazılırsa host BOŞUNA çizilmez. */
    set(key, children) {
      if (entries.has(key) && Object.is(entries.get(key), children)) return;
      entries.set(key, children);
      rebuild();
      emit();
    },
    /** Kayıt silme (unmount). Kayıt yoksa no-op. */
    remove(key) {
      if (!entries.delete(key)) return;
      rebuild();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    /** Yalnız TESTLER için: kayıtları ve sayacı sıfırlar (dinleyiciler korunur). */
    __resetForTests() {
      entries.clear();
      nextKey = 1;
      rebuild();
      emit();
    },
  };
}

/** Kök kapsam — provider gerektirmez, `SimplePortalHost` varsayılan olarak buna bakar. */
export const simplePortalStore = createSimplePortalStore();

// ⚠️ Context YALNIZ store NESNESİNİ taşır, portal VERİSİNİ değil. Değeri kararlıdır
// (kök store sabit; kapsam store'u `useRef` ile bir kez kurulur) → context asla
// güncellenmez, dolayısıyla tüketici tarafında re-render üretmez.
const SimplePortalContext = createContext<SimplePortalStore>(simplePortalStore);

/**
 * Çocuklarını EN YAKIN host'a taşır (ağacın başka yerinde çizilir).
 *
 * ⚠️ İçerik BU ağaçta render EDİLMEZ → çağıran ekranın context'leri (navigation,
 * numpad vb.) görünmez. Kural paper `Portal` ile birebir aynı; ayrıntı ve saha
 * vakaları için `AppModal.tsx` başlığına bak.
 */
export function SimplePortal({ children }: { children: React.ReactNode }) {
  const store = useContext(SimplePortalContext);
  const keyRef = useRef<number | null>(null);
  if (keyRef.current === null) keyRef.current = store.createKey();
  const key = keyRef.current;

  // Bağımlılık dizisi YOK: her render'da içerik tazelenir (paper
  // `PortalConsumer.componentDidUpdate` karşılığı). Aynı referans gelirse `set`
  // erken döner, yani boş re-render üretmez.
  useEffect(() => {
    store.set(key, children);
  });

  // Unmount'ta kayıt silinir. Ayrı effect: içerik tazelemesinin cleanup'ı YOK,
  // aksi halde her render'da sil-ekle yapılırdı (host bir kare boşalırdı).
  useEffect(() => () => store.remove(key), [store, key]);

  return null;
}

/** Bir store'un kayıtlarını çizen katman (kök host + kapsam host'u ortak kullanır). */
function PortalLayer({ store }: { store: SimplePortalStore }) {
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  if (items.length === 0) return null;

  // Yerleşim paper `PortalManager` ile birebir: her kayıt kendi `absoluteFill` +
  // `pointerEvents="box-none"` + `collapsable={false}` View'ında.
  // (`collapsable=false` — RN elevation'lı çocukları kardeşlerin üstüne sızdırmasın.)
  return (
    <>
      {items.map(({ key, children }) => (
        <View
          key={key}
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
          collapsable={false}
        >
          {children}
        </View>
      ))}
    </>
  );
}

/**
 * KÖK portal katmanı. App.tsx'te tek örnek olarak, RootNavigator'ın kardeşi ve
 * ondan SONRA mount edilir (z-düzlemi sözleşmesi için oradaki yorumlara bak).
 * Kayıt yoksa HİÇBİR ŞEY render edilmez (ekranda sıfır ayak izi).
 */
export function SimplePortalHost() {
  return <PortalLayer store={simplePortalStore} />;
}

/**
 * Kendi portal katmanına sahip alt ağaç — paper'da ikinci bir `PaperProvider`
 * (yani ikinci `Portal.Host`) ile yapılanın karşılığı. İçindeki `SimplePortal`ler
 * KÖK host'a değil BURAYA çizilir, yani bu alt ağacın z-düzleminde kalır.
 *
 * Kanonik kullanım: App.tsx'teki kilit katmanı — kilitliyken açılan sunucu adresi
 * sheet'i kilit ekranının ÜSTÜNDE kalmalı (kök host onun ALTINDA).
 */
export function SimplePortalScope({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<SimplePortalStore | null>(null);
  if (storeRef.current === null) storeRef.current = createSimplePortalStore();
  const store = storeRef.current;

  return (
    <SimplePortalContext.Provider value={store}>
      {children}
      <PortalLayer store={store} />
    </SimplePortalContext.Provider>
  );
}

export default SimplePortal;
