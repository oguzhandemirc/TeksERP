// =============================================================================
// Android `ReactEditText` MODELİ — YALNIZ TESTLER İÇİN (üretim kodu import etmez).
//
// Neden model: imleç kaybı JS'te değil ANDROID'te olur; jest ortamında native
// köprü yoktur ve RNTL'in `changeText`i RN TextInput'un iç `_onChange`ini hiç
// koşturmaz. Bu yüzden hatayı üreten iki mekanizma burada BİREBİR kodlanır:
//
//  ① RN `TextInput.js` → `useTextInputStateSynchronization` (useLayoutEffect):
//     `props.value !== lastNativeText` ise TÜM metin native'e itilir ve seçim
//     GÖNDERİLMEZ: `setTextAndSelection(ref, count, text, -1, -1)`.
//     (Sayaç modellenmez: JS'in yazdığı metin `onChange` yaymaz, yani
//     `nativeEventCount` artmaz → bu senaryoda her itiş `canUpdateWithEventCount`
//     kapısını GEÇER.)
//
//  ② Android `ReactEditText.maybeSetText` (+ `SpannableStringBuilder.replace`):
//     seçim -1 olduğu için `maybeSetSelection` hiçbir şey yapmaz. Kalan dallar:
//       · yeni metin BOŞ                → `text = null`       → imleç 0
//       · eski metin BOŞ                → saf ekleme (0,0)    → imleç ekleme ARDINA
//       · ikisi de dolu, imleç SONDA    → `replace(0,len,…)`  → imleç yine SONDA
//       · ikisi de dolu, imleç İÇERİDE  → `replace(0,len,…)`  → imleç 0'A ÇÖKER
//     Son dal `SpannableStringBuilder.change`in "değiştirilen aralığın İÇİNDE
//     kalan span başlangıcı boşluk başına (=0) taşınır" davranışıdır; aralığın
//     TAM SONUNDAKİ işaret taşınmaz, o yüzden sondan yazmak bozulmaz.
//
// MODEL RIGGED DEĞİL — sahadaki ÜÇ gözlemi de üretir:
//   · dolu kutuya yazınca ters/başa       → dördüncü dal
//   · boş kutuya sıfırdan yazınca sorun yok → ikinci + üçüncü dal
//   · içi silinip yazılınca sorun yok       → birinci + ikinci + üçüncü dal
// (Dolu kutuda imlecin başa düşmesi ayrıca RN'in kendi yorumunda da kayıtlı:
//  ReactEditText.kt ~l.233 "when you swipe to focus on a text input that already
//  has text in it, it clears the selection and resets the cursor to the beginning".)
// =============================================================================
import React, { useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';

export interface AndroidEditTextHandle {
  /** Operatörün tuşa basması: imleçteki konuma tek karakter yazar. */
  type: (ch: string) => void;
  /** Kutuyu odaklayıp imleci konumlandırmak (dokunma). */
  setCaret: (pos: number) => void;
  /** Native (EditText) tarafında GERÇEKTEN duran metin. */
  getText: () => string;
  getCaret: () => number;
  /** JS'ten native'e itilen tam metinler, sırayla (tanı için). */
  getPushes: () => string[];
}

/**
 * `react-native-paper` TextInput'un test ikizi. Prop sözleşmesi aynı
 * (`value` + `onChangeText`), davranışı yukarıdaki iki mekanizma.
 */
export function AndroidEditText({
  value,
  onChangeText,
  handleRef,
}: {
  value: string;
  onChangeText?: (t: string) => void;
  handleRef?: { current: AndroidEditTextHandle | null };
  [key: string]: unknown;
}) {
  const native = useRef({ text: value, caret: value.length });
  const [lastNativeText, setLastNativeText] = useState(value);

  // ① JS→native senkronizasyonu (RN TextInput.js ile aynı koşul ve aynı an).
  useLayoutEffect(() => {
    if (value === lastNativeText) return;
    pushFromJs(native.current, value); // ②
    setLastNativeText(value);
  });

  const handle: AndroidEditTextHandle = {
    type: (ch) => {
      const n = native.current;
      n.text = n.text.slice(0, n.caret) + ch + n.text.slice(n.caret);
      n.caret += ch.length;
      // RN `_onChange`: iç `lastNativeText` ile dışarıdaki `onChangeText` AYNI
      // olayda tetiklenir.
      setLastNativeText(n.text);
      onChangeText?.(n.text);
    },
    setCaret: (pos) => {
      native.current.caret = pos;
    },
    getText: () => native.current.text,
    getCaret: () => native.current.caret,
    getPushes: () => [...(pushes.get(native.current) ?? [])],
  };
  if (handleRef) handleRef.current = handle;

  return <View />;
}

const pushes = new WeakMap<object, string[]>();

/** ② `ReactEditText.maybeSetText` + `SpannableStringBuilder.replace` modeli. */
function pushFromJs(n: { text: string; caret: number }, next: string) {
  pushes.set(n, [...(pushes.get(n) ?? []), next]);
  if (next.length === 0) {
    n.text = '';
    n.caret = 0;
    return;
  }
  if (n.text.length === 0) {
    // replace(0, 0, …) — saf ekleme; SPAN_POINT_POINT imleç eklenen metnin ARDINA geçer.
    n.text = next;
    n.caret = next.length;
    return;
  }
  // replace(0, length(), …) — dolu aralığın tam değişimi. Aralığın TAM SONUNDAKİ
  // imleç taşınmaz (yeni metnin sonuna gider); İÇERİDE kalan imleç 0'a çöker.
  const atEnd = n.caret >= n.text.length;
  n.text = next;
  n.caret = atEnd ? next.length : 0;
}
