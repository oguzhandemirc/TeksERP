---
paths:
  - "mobil/src/**"
---

Dokunduğun dosya **tablet (mobil)** katmanındadır. Kod yazmadan/değiştirmeden ÖNCE `docs/standart/MOBIL.md` dosyasını oku (ekran = ince kabuk + görünüm + ekran-hook + saf mantık modülü, çevrimdışı kuyruk üçlüsü, `clientToken` kimliği, `signalScan`, Paper/AppModal/FlashList sözleşmesi, boyut tavanları). OTA/APK sınırı ve sürüm kapıları `docs/RECETELER.md` § Yeni mobil ekran / özellik'te. Bitince `npx tsc --noEmit` + `npm run lint` + `npx jest --runInBand` koş.
