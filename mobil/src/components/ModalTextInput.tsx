// =============================================================================
// ModalTextInput — AppModal (portal) İÇİNDEKİ metin kutusu. Kontrollü `value`yu
// DIŞARIDAN alan her TextInput'un Android'de imleci kaybettiği sınıfı kapatır.
//
// SAHA BULGUSU (2026-09-04, Tambur → "Müşterideki kumaş adı"): dolu bir kutunun
// içine yazınca karakterler metnin BAŞINA ve TERS SIRADA gidiyordu ("ABC" +
// D,E → "EDABC"). Kutu boşken ya da içi silinip sıfırdan yazılınca sorun yoktu.
//
// KÖK SEBEP — portal bir commit gecikmesi yaratır:
//   AppModal içeriği `SimplePortal` ile HOST ağacına taşınır ve host'a bildirim
//   BİLEREK bir mikrotask'a ertelenir (SimplePortal.tsx başlığı, SM-X230 çökme
//   dersi — o erteleme kaldırılamaz). Sonuç: tuşa basıldığında
//     · `onChangeText` → dıştaki bileşenin state'i güncellenir,
//     · ama TextInput'un aldığı `value` prop'u ancak BİR MİKROTASK SONRA tazelenir.
//   RN'in `useTextInputStateSynchronization`'ı (TextInput.js) tam o aradaki
//   commit'te `props.value` (ESKİ) ≠ `lastNativeText` (YENİ) görür ve ESKİ metni
//   native'e geri iter: `setTextAndSelection(ref, count, eskiMetin, -1, -1)`.
//   Android tarafında `ReactEditText.maybeSetText` bunu
//   `text.replace(0, length(), …)` ile uygular ve seçim -1 olduğu için
//   `maybeSetSelection` HİÇBİR ŞEY YAPMAZ → imleç 0'a çöker. Bir sonraki tuş
//   0. konuma yazılır; yazdıkça ters sırada başa yığılır.
//   Kutu BOŞKEN ısırmaz: uzunluğu 0 olan itiş `text = null` dalına düşer, ardından
//   gelen itiş de saf eklemedir (imleç ilerler) — sahadaki "boşta sorun yok"
//   gözleminin birebir açıklaması budur.
//
// ÇÖZÜM: kutunun sürdüğü değer PORTALIN İÇİNDE yaşasın. Taslak state burada
// tutulur (yani host ağacında), böylece tuş vuruşunda `value` ile RN'in kendi
// `lastNativeText`i AYNI commit'te güncellenir — itiş hiç doğmaz, imleç bozulmaz.
// Dıştaki state yalnız YANKIYI alır (kaydetme yolu, doğrulama, buton kilidi
// aynen çalışır — sözleşme değişmedi).
//
// ⚠️ EŞİTLEME KOŞULU `value` PROP'UNUN DEĞİŞMESİDİR, "taslaktan farklı olması"
// DEĞİL. İkincisi yazılırsa yukarıdaki bayat pencerede (prop hâlâ eski) taslak
// eski değere geri çekilir ve kutu her tuşta kendini geri alır — yani hatanın
// aynadaki ikizi. Ön-doldurma / sıfırlama / dışarıda normalizasyon prop'u
// gerçekten değiştirdiği için doğru şekilde eşitlenir.
//
// ⚠️ Bu sınıf AppModal içindeki HER kontrollü TextInput için geçerlidir; ısırması
// için kutunun DOLU olması gerekir. Yeni bir modal alanı ön-doldurulmuş
// açılıyorsa bunu kullan. Bekçi: `ModalTextInput.test.tsx` (Android imleç modeli).
// =============================================================================
import React, { forwardRef, useRef, useState } from 'react';
import { TextInput } from 'react-native-paper';

type PaperTextInputProps = React.ComponentProps<typeof TextInput>;

export type ModalTextInputProps = Omit<PaperTextInputProps, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (text: string) => void;
};

// ⚠️ ref tipi paper'da kesişim (TextInput & TextInputHandles) olarak duruyor;
// jenerikten geçmiyor, olduğu gibi iletilir.
type PaperTextInputRef = PaperTextInputProps['ref'];

const ModalTextInput = forwardRef<unknown, ModalTextInputProps>(function ModalTextInput(
  { value, onChangeText, ...rest },
  ref,
) {
  const [draft, setDraft] = useState(value);
  // En son GÖRDÜĞÜMÜZ dış değer. Karşılaştırma taslakla değil bununla yapılır
  // (yukarıdaki ⚠️): prop değişmediyse gelen render bayat penceredir, dokunma.
  const seenValue = useRef(value);

  if (value !== seenValue.current) {
    seenValue.current = value;
    // Render sırasında kendi state'ini düzeltmek React'in "prop değişti"
    // kalıbıdır: ek commit doğurmaz, çocuklar bir kez bile eski değerle çizilmez.
    if (value !== draft) setDraft(value);
  }

  return (
    <TextInput
      ref={ref as PaperTextInputRef}
      {...rest}
      value={draft}
      onChangeText={(text: string) => {
        setDraft(text);
        onChangeText(text);
      }}
    />
  );
});

export default ModalTextInput;
