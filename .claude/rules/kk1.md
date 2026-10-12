---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{kk1,KK1,entryAttempt,attemptToken,duplicate-guard,duplicateEntry,token-replay}*"
  - "{Electron,mobil}/src/**/offline/**"
---

**KK1 · idempotency · çevrimdışı** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/kk1.md § "Ortak"`
- `docs/kurallar/kk1.md § "Backend"`
- `docs/kurallar/kk1.md § "Tablet"`

- KK1 mükerrer tuzağı tx içinde koşar; İLK ifade `pg_advisory_xact_lock(8021, …)`.
- "KK1'in işi olan top" kümesi tek sabit (`KK1_ENTRY_SOURCES` ↔ mobil aynası).
- Kayıt yaratan uç `clientToken @unique` taşır; istemci token'ı mantıksal deneme başına bir kez üretir (`attemptToken`).
- Token yalnız belirsiz hatada (ağ/zaman aşımı/5xx) yapışır; kesin 4xx'te yapışmaz.
- Replay tek boğazdan: `tokenReplay` (`helpers/token-replay.helper.ts`); istisna `scripts/lib/token-replay-beyan.ts`te.
- Bitince alan bekçilerini koş (`/bekci-kos kk1`; liste `docs/kurallar/kk1.md § "Bekçiler"`); yeni karar → `/karar-notu`.
