# PLAN gm-t1 — Tablet okuma kartı: parti no + kurşun metresi (dilim T1)

Tasarım: ~/.tekserp/gulkesim/PARTI-METRE-TASARIM-2026-11-02.md §2.3, §3 T1.

## Senaryo
1. Okuma özeti (`okuma-ozeti`) A dilimiyle §2.3 başlık alanlarını (`ourBatchNo`, `ourBatchNoKey`,
   `kursunMeters`, `kursunMetersSource`, `kursunMetersReview`) ve `batchNoCandidates[]`,
   `kursunMeterCandidates{output,total,input,lineSum}` döner. Hepsi OPSİYONEL (eski sunucu göndermez).
2. Kart (READ/PARTIAL):
   - `ourBatchNo` doluysa "Parti no: ISM1439770".
   - boşsa ve aday > 1 → "Parti no: Panelde seçilecek (N aday)" (warn).
   - boşsa ve aday yok/1 → satır yok (seri yedeği; kural istemcide yok).
   - `kursunMeters` doluysa "Kurşun: 241 m (çıkış)" — kaynak etiketi OUTPUT=çıkış, TOTAL=toplam metre,
     LINE_SUM=satır toplamı, MANUAL=elle. Review açıksa tone warn + not "Kurşun metresi panelde doğrulanacak."
     ve kart yeşil olmaz.
   - Alanlar yoksa (eski backend) satır görünmez, görünüm bayt-aynı.
3. Kurşun istasyonu: tek büyük top (4.521 m / 960 kg) — kod değişikliği yok; backend `test_kursun_metre_stok`
   + `test_kursun_metre` koşulur (sınama).

## Dosyalar
- mobil/src/services/inboundDoc.service.ts (ReadSummary opsiyonel alanlar)
- mobil/src/screens/Modules/GelenBelge/readResult.ts (satır + not + ton)
- readResult.test.ts, DocScanScreen.test.tsx

## Kabul
- readResult.test.ts: yeni alanlar (tek aday dolu, çok aday, review, kaynak etiketleri, ondalık/binlik), eski yanıt (alan yok → satır yok).
- DocScanScreen.test.tsx: kartta "Parti no" ve "Kurşun" görünür.
- Backend: test_kursun_metre_stok, test_kursun_metre (tek top 4.521 m).
- Negatif sonda: alan yokken satırı çiz → "eski backend" vakası kırmızı.
