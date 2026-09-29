# satici/sunucu — TeksERP satıcı (lisans) sunucusu

> Kök `CLAUDE.md` çekirdeği burada da AYNEN geçerlidir (defter semantiği, atomik claim, advisory kilit tx'in ilk ifadesi, fail-closed kapı, `details.code`, TR mesaj, sır hijyeni). Plan: Kod Koruma + Lisanslama (Faz 1b). Sözleşme: `docs/design/LISANS-PROTOKOLU.md`.

## Amaç

Fabrikaların lisansını verir ve yönetir: **etkinleştirme** (tek kullanımlık kod → HAK + KİRA), **yoklama** (kira yenileme + kira zinciri kararı + indirme belirteçleri), **kapı zili** (SSE; içerik taşımaz, "şimdi yokla" der), **çevrimdışı/QR**, **taşıma** (her taşıma satıcı onayıyla), **DR devralımı** (self-servis + anında bildirim), **yaptırım** (K0–K5, zorlama, geçerlilik bitişi, planlı eylem, taksit), **portal JSON API'si** (satıcı: tailnet `/portal/api` · bayi: genel `/bayi/api`). Portal web arayüzü (`satici/web`) 1f'de gelir.

## Katmanlar

| Katman | Yer | Kural |
|---|---|---|
| Protokol | `src/lisans-protokol/` | `Teks-Erp/src/lib/license/protocol/` klasörünün **BAYT-EŞİT aynası**. Burada DÜZENLENMEZ: değişiklik önce Teks-Erp'te, sonra kopya. Bekçi `Teks-Erp/scripts/test_lisans_protokol_aynasi.ts` |
| Anahtar | `src/keys/` | Kök/bayi parolalı (scrypt + AES-256-GCM); parola YALNIZ imza alt sürecinin stdin'ine (argv/env ASLA), Buffer iş bitince sıfırlanır. ALT/İNDİRME 0600, kök imzalı sertifikalı. Çapa: gömülü `ROOT_PUBLIC_KEYS`; `GUVEN_CAPASI_DOSYASI` yalnız hazırlık/test |
| Servis | `src/services/` | İş kuralı + tx. Durum geçişi atomik claim (`updateMany WHERE {id, beklenen}` + `count===0 → 409`); `tx.*` `Promise.all`'a girmez |
| HTTP | `src/http/` | Genel dinleyici: `/v1/*` + `/q` + `/bayi/api` (yalnız BAYI). Tailnet dinleyicisi: `/portal/*` (soket + kaynak ağı kapısı, fail-closed 404). `/v1` gövdesi ham baytlarıyla alınır (imzalı özet) ve KATI şemadan geçer |
| Portal | `src/portal/` + `src/http/portal-*.ts` · `dealer-routes.ts` | Rota TABLOSU veridir: her rota izin (`roles.ts`) + kimlik beyanı taşır; yazma `executePortalAction` (işlem kimliği + eylem + denetim tek boğaz). Oturum: parola scrypt + TOTP ZORUNLU tek adım, çerez httpOnly + SameSite=Strict, oturum doğduğu dinleyiciye bağlı |
| Şema | `prisma/` | Müşteri → Tesis → Kurulum → Hak; defterler (`hak_surumu`, `kira`, `yaptirim_eylemi`, `kurulum_kaydi`) DB tetikleyicisiyle değişmez; telemetri (`nonce_defteri`, `yoklama`) yaşa göre budanır |

- **Tek süreç, iki dinleyici** (`src/server.ts`): `PORT_GENEL`/`GENEL_BIND` + `PORT_TAILNET`/`TAILNET_BIND` (joker adres açılışta RED). Sıkıştırma ara katmanı yok (zil `no-transform`).
- **Zil**: portal eylemi kendi tx'inde `pg_notify('satici_zil', …)` → COMMIT'te sunucunun PG dinleyicisi aboneye iletir (eylemi yapan süreç sunucu olmak zorunda değil).
- **Kira zinciri** (`services/lease-chain.ts`, SAF): uçta NORMAL · (b) 15 dk içinde aynı ucun tekrarı → AYNI kira · (a) aynı makine geride → YAKALA (uyarı yok) · (c) farklı makine → ÇATAL (ilk pencere uyarı, ikincide eşleşmeyen tarafa 403 `KIRA_VERILMEDI`; sahip asla reddedilmez).
- **Sır**: özel anahtar, parola, etkinleştirme kodunun düz metni DB'ye, loga, denetime GİRMEZ (kod sha256 + son 4). `.env` ve `anahtarlar/` repoya girmez.

## Portal (JSON API)

- **Rol × dinleyici KESKİN:** `SATICI_YONETICI` · `SATICI_OPERATOR` yalnız TAILNET'ten, `BAYI` yalnız GENEL'den girer; uymayan hesap bilinmeyen hesap gibi davranır (sayaç değişmez, eşdeğer scrypt işi). İzin tablosu tek kaynak `src/portal/roles.ts`; K4/K5 · zorlama · kurulum iptali · bayi · kullanıcı yönetimi yalnız YÖNETİCİ.
- **Giriş:** kullanıcı adı + parola + TOTP (RFC 6238, tekrar oynatma kilidi) TEK adımda; hata iletisi tek; ardışık başarısızlıkta hesap süreli kilit. TOTP sırrı AES-256-GCM ile sarılı (anahtar `ANAHTAR_DIZINI/portal-totp.key`, DB'de değil); kurulumu hesabı açan yönetici yapar, sır yalnız o yanıtta BİR KEZ. İlk yönetici: `scripts/portal-kullanici.ts ekle`.
- **İdempotency:** her yazma `clientToken` taşır; eylem ile `portal_islemi` satırı AYNI tx'te yazılır → aynı kimlik aynı yanıtı alır, eylem ikinci kez koşmaz; başka kullanıcı/eylem/gövde 409 `ISLEM_KIMLIGI_CAKISTI`. Sır alanları gövde özetine ve saklanan yanıta girmez (kod/TOTP tekrarında `…Gosterilemez: true`).
- **Kök/bayi parolası** formdan → imza alt sürecinin stdin'ine (hazırlık tx DIŞINDA), Buffer sıfırlanır. HAK'ın yapısal değişikliği (modül tavanı · kalıcı · bakım) yalnız YENİ İMZALI SÜRÜMLE olur; `production.enabled` varsayılan dahil, çıkarılırken açık onay (`URETIM_MODULU_UYARISI`).
- **Bayi imzalı HAK:** protokolün sertifika kısıtına EK olarak bayinin GÜNCEL tavanı (modül ⊆ · sınıf ⊆ · kurulum adedi) imzadan önce ve bayi kilidi altında yeniden denetlenir (`BAYI_TAVANI_ASILDI`). Tavan sürümlü defterdir (`bayi_tavani`).
- **Portal hata kodları** (`src/lib/errors.ts` `PORTAL_ERROR_CODES`) protokolün DIŞINDADIR; `/v1/*` yalnız protokol kodlarını döndürür.

## Advisory kilit envanteri (satıcı DB'si — backend'in 80xx uzayından bağımsız)

Kilit tx'in İLK ifadesidir; birden çok kilit bu SIRADA alınır: `PORTAL_TOKEN → DEALER → CUSTOMER → INSTALLATION` (kimlik sırasıyla, `lockInstallations`) `→ LICENSE_NUMBER`. Tek tanım `src/lib/locks.ts` `LOCK_NAMESPACES`; bu tablo onunla birebir, sıra da ölçülür (bekçi `scripts/test_satici_kapilari.ts` §1, §7).

| Uzay | Ad | Kapsam |
|---|---|---|
| 9101 | `INSTALLATION` | kurulum başına: etkinleştirme · yoklama/kira · taşıma · DR · yaptırım · HAK sürümü · kod üretimi |
| 9102 | `LICENSE_NUMBER` | lisans numarası sayacı (`TKS-YYYY-NNNN`, yıl başına) |
| 9103 | `DEALER` | bayi başına: tavan değişimi · bayi imzalı HAK · bayinin kurulum adedi |
| 9104 | `PORTAL_TOKEN` | portal işlem kimliği (clientToken) başına: aynı kimlikli eşzamanlı denemeler sıraya girer |
| 9105 | `CUSTOMER` | müşteri ağacı başına: tesis/kurulum doğumu ↔ müşteri/tesis/kurulum pasife-aktife alma (MV-06) |

## Budama beyanı (telemetri)

Yaşa göre silinen tablolar YALNIZ: `nonce_defteri` (`sonKullanim` = istek zamanı + 10 dk geçti) · `yoklama` (`YOKLAMA_SAKLAMA_GUN`) · `portal_oturumu` (bitişinden/kapanışından `PORTAL_OTURUM_SAKLAMA_GUN` sonra) · `portal_islemi` (işlem kimliği; `PORTAL_ISLEM_SAKLAMA_GUN`). Hiçbir iş kararı bunları okumaz (zincir kararı `kira`dan, güncel sağlık `kurulum.sonSaglik`ten, eylemin kendisi kendi defterinden). Başka her silme yasak; bekçi ölçer. Defterler (tetikleyiciyle değişmez): `hak_surumu` · `kira` · `yaptirim_eylemi` · `kurulum_kaydi` · `bayi_tavani`.

## Komutlar

```bash
cd satici/sunucu
npx prisma migrate deploy && npx prisma generate      # migrate dev/reset YASAK (yeni migration: migrate diff ile üret)
npx tsx scripts/anahtar.ts kok-uret --kid=kok-2026-1  # parola TTY/stdin; alt-uret · indirme-uret · bayi-uret
npx tsx scripts/portal-kullanici.ts ekle --kullanici=ad --ad-soyad="Ad Soyad" --rol=SATICI_YONETICI  # ilk yönetici (parola TTY/stdin; TOTP sırrı BİR KEZ basılır)
npm run typecheck && npm run typecheck:scripts
node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts [ad-parçası]   # yalnız *_test DB
```

`.env` (repoya girmez, 0600): `DATABASE_URL` (kendi `_test` DB'si; `tekserp_fabrika_*` ASLA) · `PORT_GENEL` · `TAILNET_BIND` · `PORT_TAILNET` · `ANAHTAR_DIZINI` · (yalnız test) `GUVEN_CAPASI_DOSYASI`. Bekçiler `scripts/test_*.ts`; harita `Teks-Erp/docs/BEKCI-HARITASI.md` § lisans.
