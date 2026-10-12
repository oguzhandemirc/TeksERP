---
paths:
  - "mobil/src/**"
---

**Tablet (mobil)** — öz. Standardı baştan okuma; yalnız ilgili bölüm:
- `docs/standart/MOBIL.md § 1` ekran kalıbı · § 3 çevrimdışı · § 4 idempotency
- `docs/standart/MOBIL.md § 11` OTA/APK sınırı
- `docs/RECETELER.md § "Yeni mobil ekran"`

- Ekran = ince kabuk + görünüm + ekran-hook + saf mantık modülü; katman ekran → servis → apiClient.
- Kayıt yaratan çağrı deneme başına tek `clientToken` taşır (`attemptToken`).
- Okutma geri bildirimi `signalScan`; Paper/AppModal/FlashList sözleşmesi.
- `!== "mobile"` yazma; `clientType` güvenlik sınırı değil.
- Bitince `npx tsc --noEmit` + `npm run lint` + `npx jest --runInBand`.
