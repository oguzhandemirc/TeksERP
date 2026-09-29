# satici/sunucu — TeksERP satıcı (lisans) sunucusu

> Kök `CLAUDE.md` çekirdeği burada da AYNEN geçerlidir (defter semantiği, atomik claim, advisory kilit tx'in ilk ifadesi, fail-closed kapı, `details.code`, TR mesaj, sır hijyeni). Plan: Kod Koruma + Lisanslama (Faz 1b). Sözleşme: `docs/design/LISANS-PROTOKOLU.md`.

## Amaç

Fabrikaların lisansını verir ve yönetir: **etkinleştirme** (tek kullanımlık kod → HAK + KİRA), **yoklama** (kira yenileme + kira zinciri kararı + indirme belirteçleri), **kapı zili** (SSE; içerik taşımaz, "şimdi yokla" der), **çevrimdışı/QR**, **taşıma** (her taşıma satıcı onayıyla), **DR devralımı** (self-servis + anında bildirim), **yaptırım** (K0–K5, zorlama, geçerlilik bitişi, planlı eylem, taksit). Portal web'i (`satici/web`) 1f'de gelir; bu dilimde portal JSON API'si YOK — portal eylemleri servis fonksiyonudur.

## Katmanlar

| Katman | Yer | Kural |
|---|---|---|
| Protokol | `src/lisans-protokol/` | `Teks-Erp/src/lib/license/protocol/` klasörünün **BAYT-EŞİT aynası**. Burada DÜZENLENMEZ: değişiklik önce Teks-Erp'te, sonra kopya. Bekçi `Teks-Erp/scripts/test_lisans_protokol_aynasi.ts` |
| Anahtar | `src/keys/` | Kök/bayi parolalı (scrypt + AES-256-GCM); parola YALNIZ imza alt sürecinin stdin'ine (argv/env ASLA), Buffer iş bitince sıfırlanır. ALT/İNDİRME 0600, kök imzalı sertifikalı. Çapa: gömülü `ROOT_PUBLIC_KEYS`; `GUVEN_CAPASI_DOSYASI` yalnız hazırlık/test |
| Servis | `src/services/` | İş kuralı + tx. Durum geçişi atomik claim (`updateMany WHERE {id, beklenen}` + `count===0 → 409`); `tx.*` `Promise.all`'a girmez |
| HTTP | `src/http/` | Genel dinleyici: `/v1/*` + `/q`. Tailnet dinleyicisi: `/portal/*` (soket + kaynak ağı kapısı, fail-closed 404). Gövde ham baytlarıyla alınır (imzalı özet) ve KATI şemadan geçer |
| Şema | `prisma/` | Müşteri → Tesis → Kurulum → Hak; defterler (`hak_surumu`, `kira`, `yaptirim_eylemi`, `kurulum_kaydi`) DB tetikleyicisiyle değişmez; telemetri (`nonce_defteri`, `yoklama`) yaşa göre budanır |

- **Tek süreç, iki dinleyici** (`src/server.ts`): `PORT_GENEL`/`GENEL_BIND` + `PORT_TAILNET`/`TAILNET_BIND` (joker adres açılışta RED). Sıkıştırma ara katmanı yok (zil `no-transform`).
- **Zil**: portal eylemi kendi tx'inde `pg_notify('satici_zil', …)` → COMMIT'te sunucunun PG dinleyicisi aboneye iletir (eylemi yapan süreç sunucu olmak zorunda değil).
- **Kira zinciri** (`services/lease-chain.ts`, SAF): uçta NORMAL · (b) 15 dk içinde aynı ucun tekrarı → AYNI kira · (a) aynı makine geride → YAKALA (uyarı yok) · (c) farklı makine → ÇATAL (ilk pencere uyarı, ikincide eşleşmeyen tarafa 403 `KIRA_VERILMEDI`; sahip asla reddedilmez).
- **Sır**: özel anahtar, parola, etkinleştirme kodunun düz metni DB'ye, loga, denetime GİRMEZ (kod sha256 + son 4). `.env` ve `anahtarlar/` repoya girmez.

## Advisory kilit envanteri (satıcı DB'si — backend'in 80xx uzayından bağımsız)

Kilit tx'in İLK ifadesidir; birden çok kilit kimlik sırasıyla (`lockInstallations`). Tek tanım `src/lib/locks.ts` `LOCK_NAMESPACES`; bu tablo onunla birebir (bekçi `scripts/test_satici_kapilari.ts`).

| Uzay | Ad | Kapsam |
|---|---|---|
| 9101 | `INSTALLATION` | kurulum başına: etkinleştirme · yoklama/kira · taşıma · DR · yaptırım · HAK sürümü · kod üretimi |
| 9102 | `LICENSE_NUMBER` | lisans numarası sayacı (`TKS-YYYY-NNNN`, yıl başına) |

## Budama beyanı (telemetri)

Yaşa göre silinen tablolar YALNIZ: `nonce_defteri` (`sonKullanim` = istek zamanı + 10 dk geçti) · `yoklama` (`YOKLAMA_SAKLAMA_GUN`). Hiçbir iş kararı bunları okumaz (zincir kararı `kira`dan, güncel sağlık `kurulum.sonSaglik`ten). Başka her silme yasak; bekçi ölçer.

## Komutlar

```bash
cd satici/sunucu
npx prisma migrate deploy && npx prisma generate      # migrate dev/reset YASAK (yeni migration: migrate diff ile üret)
npx tsx scripts/anahtar.ts kok-uret --kid=kok-2026-1  # parola TTY/stdin; alt-uret · indirme-uret · bayi-uret
npm run typecheck && npm run typecheck:scripts
node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts [ad-parçası]   # yalnız *_test DB
```

`.env` (repoya girmez, 0600): `DATABASE_URL` (kendi `_test` DB'si; `tekserp_fabrika_*` ASLA) · `PORT_GENEL` · `TAILNET_BIND` · `PORT_TAILNET` · `ANAHTAR_DIZINI` · (yalnız test) `GUVEN_CAPASI_DOSYASI`. Bekçiler `scripts/test_*.ts`; harita `Teks-Erp/docs/BEKCI-HARITASI.md` § lisans.
