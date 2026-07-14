# Fason Kabul — Cihazda Manuel E2E Kontrol Listesi

> **Neden bu liste var:** Sahada kritik bir hata yaşandı — boyahaneye 1 sevk/2 top gönderilip
> **kabul iki seferde** yapılınca Kurşun'a **2 yerine 3 top** geçti. Kök neden mobil Fason Kabul
> ekranında "dönen açık kumaş" (newRolls) satırlarının partinin tüm topundan ön-doldurulup
> operatörün ✓ kaldırmasına bağlanmamasıydı. Otomatik testler bu hatayı backend ve ekran-mantığı
> seviyesinde kilitledi (bkz. aşağıdaki "İlgili otomatik testler"). Bu liste, **gerçek tablette**
> dokunma akışını doğrulayan son katmandır. Her sürümden önce ve fason kabul ekranına dokunan her
> değişiklikten sonra koşulmalıdır.

**Ortam:** Gerçek Android tablet/telefon + canlı backend. Test kullanıcısı: `admin / 123123`.
**Ön hazırlık:** Stokta birkaç top + en az bir boyahane (fason) firması tanımlı bir iş emri.

İşaretleme: her adımın sonundaki sonucu doğrula, `[ ]` → `[x]`.

---

## 1. Tam kabul (taban doğrulama)
- [ ] Bir iş emrinde **2 top** boyahaneye sevk et.
- [ ] Fason Kabul'de partiyi seç; **2 top da işaretli** ve **2 parça** ön-dolu gelir.
- [ ] Gönder.
- **Beklenen:** Kurşun/KK2'de **2 top** görünür. Boyahane adımı COMPLETED.

## 2. ⭐ Kısmi kabul — SAHA BUG SENARYOSU (en kritik)
- [ ] **2 top** boyahaneye sevk et.
- [ ] Boyahaneden **yalnız 1 top geldi**. Fason Kabul'de partiyi seç.
- [ ] **Gelmeyen topun ✓'sini kaldır** (1 top işaretli kalsın).
- [ ] Buton etiketi **"1 top → 1 parça"** demeli (3 değil!). "Dönen açık kumaş" listesinde **1 satır** kalmalı.
- [ ] Gönder.
- **Beklenen:** Kurşun'da **1 top** (3 değil). 
- [ ] Daha sonra ikinci top gelince onu da kabul et.
- **Beklenen:** Kurşun'da **toplam 2 top** (asla 3). ✅ Hata düzeldi.

## 3. Merge (boyahane topları birleştirir) — meşru
- [ ] 2 top sevk et, **ikisi de geldi** ama boyahane **tek parça** olarak döndürdü.
- [ ] Kabul'de 2 topu da işaretle, "Dönen açık kumaş"ı **tek parçaya indir** (fazla satırı sil).
- [ ] Gönder (metraj-fark uyarısı çıkarsa onayla).
- **Beklenen:** Kurşun'da **1 top**. (Backend buna izin verir; doğru.)

## 4. Split (boyahane topu böler) — meşru
- [ ] 1 top sevk et, geldi; boyahane **2 parça** olarak döndürdü.
- [ ] Kabul'de topu işaretle, "Parça ekle" ile **2 parça** yap.
- [ ] Gönder.
- **Beklenen:** Kurşun'da **2 top**. (Doğru.)

## 5. Çoklu parti
- [ ] Aynı adıma **2 ayrı sevk** yap (örn. önce 2 top, sonra 1 top).
- [ ] Fason Kabul'de partiyi seç → **parti seçim ekranı 2 parti** gösterir.
- [ ] **Sadece 1. partiyi** kabul et.
- **Beklenen:** 1. partinin topları Kurşun'a geçer; **2. parti hâlâ bekliyor** listede görünür; adım ACTIVE.

## 6. Kabul iptali → yeniden kabul
- [ ] Bir topu kabul et (Kurşun'da görünsün).
- [ ] Kabulü **iptal et** (iptal sebebi gir).
- **Beklenen:** Kurşun'daki o top kaybolur; orijinal top tekrar "boyahanede bekliyor" olur.
- [ ] Aynı topu **yeniden kabul et**.
- **Beklenen:** Kurşun'da **tam 1 top** (öksüz/çift yok).

## 7. Taslak (draft) kurtarma
- [ ] Kabul formunu doldur (top seç, parça gir) ama **gönderme**.
- [ ] Uygulamayı arka plana al / kapat (OS öldürene kadar) ve yeniden aç.
- **Beklenen:** Form kaldığın yerden gelir; işaretli toplar ile "dönen açık kumaş" satırları **tutarlı** (uyumsuz/fazla parça yok).

---

## Kabul kriteri
**Madde 2 mutlaka 2 (asla 3) vermeli.** Diğer maddeler beklenen sonuçları vermeli. Bir sapma
görülürse sürüm yayınlanmaz; geliştiriciye senaryo numarası + ekran görüntüsüyle bildirilir.

## İlgili otomatik testler (regresyon kalkanı)
- Backend (gerçek DB): `Teks-Erp/scripts/test_fason_partial_receive_overcount.ts` (A–G), 
  `test_fason_receive_cancel_rereceive.ts`, `test_fason_receive_idempotency_concurrency.ts` —
  `npx tsx scripts/run-all-tests.ts` ile hepsi koşar.
- Mobil (jest): `mobil/src/screens/Modules/FasonKabul/newRolls.helper.test.ts` +
  `receivePayload.helper.test.ts` — `npx jest src/screens/Modules/FasonKabul`.
- Kök neden + fix detayı: bu listenin başındaki "Neden bu liste var" notu +
  `scripts/test_fason_partial_receive_overcount.ts` başlık yorumu (A=SAHA BUG / B=FIX,
  ayrıca C=MERGE, D=SPLIT, E=3 TOP birikim, F=son adım final, G=validation senaryoları).
