---
paths:
  - "Teks-Erp/scripts/lib/defter-beyan.ts"
  - "{Teks-Erp,Electron,mobil}/src/**/*{ledger,Ledger,-movement,reversal}*"
---

**Defter · hareket tablosu · ters kayıt · hard delete** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/defter.md § "Doktrin"`
- `docs/kurallar/defter.md § "Ortak"`
- `docs/kurallar/defter.md § "Mevcut defter envanteri"`

- Durum tablosu "şu an ne", defter "ne oldu"yu tutar; defter satırını silme, değiştirme, ileri damgayı `null`'lama.
- Hard delete yalnız iki sınıf: saf yapılandırma pivotu replace'i ve deftere hiç yazmamış taslak (atomik claim'li); kalan her "sil" bir durum geçişidir.
- Deftere yazan her yeni ileri kaynağa beyanlı bir ters mekanizma ver (`scripts/lib/defter-beyan.ts`; ölçen `test_defter_ters_yol`).
- Ters kaydı daima bugüne yaz; kronoloji `createdAt`, "en son" okuyucusuna eşitlik bozucu koy.
- Satırın defter olup olmadığını ölç: silinince raporlanan hiçbir sayı değişmiyorsa telemetri/audit sınıfıdır.
- Bitince alan bekçilerini koş (`/bekci-kos defter`; liste `docs/kurallar/defter.md § "Bekçiler"`); yeni karar → `/karar-notu`.
