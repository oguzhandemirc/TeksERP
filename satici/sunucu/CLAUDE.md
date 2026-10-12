# satici/sunucu — TeksERP satıcı (lisans) sunucusu

> Kök `CLAUDE.md` çekirdeği burada da AYNEN geçerlidir (defter, atomik claim, kilit tx'in ilk ifadesi, fail-closed, `details.code`, TR mesaj, sır hijyeni). Sözleşme `docs/design/LISANS-PROTOKOLU.md`. Alt-alan kuralları `docs/kurallar/lisans.md` § Satıcı sunucusu; anlatım ve tam ayrıntı (katman tablosu, portal, hata kodları, budama, şema, CLI, ortam) `satici/sunucu/MIMARI.md`; bekçiler `Teks-Erp/docs/BEKCI-HARITASI.md` § lisans.

## Amaç

Fabrikaların lisansını verir ve yönetir: etkinleştirme (kod → HAK + KİRA), yoklama, kapı zili (SSE, içerik taşımaz), çevrimdışı/QR, taşıma (yeni makine yalnız TALEP açar), DR devralımı, yaptırım, portal JSON API'si. Ayrıntı `MIMARI.md` § Amaç.

## Katmanlar

- **Protokol** `src/lisans-protokol/`: `Teks-Erp/src/lib/license/protocol/` klasörünün BAYT-EŞİT aynası; burada DÜZENLENMEZ, önce Teks-Erp sonra kopya (bekçi `test_lisans_protokol_aynasi.ts`).
- **Anahtar** `src/keys/`: kök/bayi/ara parolalı; parola YALNIZ imza alt sürecinin stdin'ine (argv/env ASLA), Buffer sıfırlanır; tutulmayan ISTEMCI/PAKET yalnız açık sertifikayla; çapa gömülü `PRODUCTION_ROOT_PUBLIC_KEYS`, `GUVEN_CAPASI_DOSYASI` yalnız test.
- **Servis** `src/services/`: durum geçişi atomik claim; `tx.*` `Promise.all`'a girmez.
- **HTTP** `src/http/`: `/v1` gövdesi ham baytla alınır ve KATI şemadan geçer; sıra IP hız → şema → imza → ön denetim → kurulum hız → nonce → kilit/tx (reddedilen istek nonce/kilit tüketmez; bekçi `test_genel_dinleyici`). Dinleyici yalnız kendi uygulamasını sunar.
- **Portal** `src/portal/`: rota tablosu veridir (izin + kimlik beyanı); yazma tek boğaz `executePortalAction`.
- **Tek süreç, üç dinleyici:** 4610 genel · 4612 iç API · 4613 portal (ERİŞİM, yalnız `PORT_ERISIM` verilirse); iç ve erişim için joker adres RED.
- **Sır:** özel anahtar, parola, etkinleştirme kodunun düz metni DB'ye, loga, denetime GİRMEZ (kod HMAC + son 4). `.env` ve `anahtarlar/` repoya girmez.
- **Zil:** portal eylemi kendi tx'inde `pg_notify('satici_zil', …)`.

## Portal (JSON API)

- **Rol × dinleyici keskin:** `SATICI_YONETICI`/`SATICI_OPERATOR` yalnız ERİŞİM'den, `BAYI` yalnız GENEL'den; uymayan hesap bilinmeyen hesap gibi davranır. İzin tablosu tek kaynak `src/portal/roles.ts`; ağır işlemler yalnız YÖNETİCİ; tünel yolu yok (bekçi `test_tunel_yok`).
- **Giriş:** kullanıcı adı + parola + TOTP tek adımda; hata iletisi tek; TOTP sırrı DB dışı anahtarla sarılı, yalnız açılış yanıtında BİR KEZ.
- **İdempotency:** her yazma `clientToken` taşır; eylem ile `portal_islemi` AYNI tx'te; sır alanları özete ve saklanan yanıta girmez.
- **İmza parolası** stdin'e, hazırlık tx DIŞINDA; boğaz `signWithWrappedKey`; ardışık hatada imza kilidi. HAK'ın yapısal değişikliği yalnız YENİ İMZALI SÜRÜMLE.
- **Hata kodları iki liste, KESİŞMEZ:** protokol (`VENDOR_ERROR_CODES`/`PROTOCOL_ERROR_CODES`) ↔ portal (`src/lib/errors.ts` `PORTAL_ERROR_CODES`); iç API üçüncü liste; P2002 → 409 `TEKRAR_DENEYIN` (bekçi `test_satici_kapilari` §8). Tam liste `MIMARI.md`.

## Advisory kilit envanteri (satıcı DB'si — backend'in 80xx uzayından bağımsız)

Kilit tx'in İLK ifadesidir; birden çok kilit bu SIRADA alınır: `PORTAL_TOKEN → DEALER → CUSTOMER → TRANSFER_KEY → INSTALLATION → LICENSE_NUMBER → UPLOAD_REQUEST → UPLOAD_SESSION → SHARED_FILE → DOWNLOAD_LINK → KEY_SET → UPDATE_WAVE` (çoklular kimlik sırasıyla: `lockDealers`, `lockInstallations`, `lockUploadScope`). Tek tanım `src/lib/locks.ts` `LOCK_NAMESPACES`; tablo onunla birebir (bekçi `scripts/test_satici_kapilari.ts` §1, §7).

| Uzay | Ad | Kapsam |
|---|---|---|
| 9101 | `INSTALLATION` | kurulum başına: etkinleştirme · kira · taşıma · DR · yaptırım · HAK · kod |
| 9102 | `LICENSE_NUMBER` | lisans numarası sayacı (yıl başına) |
| 9103 | `DEALER` | bayi başına: tavan · bayi imzalı HAK · kurulum adedi |
| 9104 | `PORTAL_TOKEN` | portal işlem kimliği başına |
| 9105 | `CUSTOMER` | müşteri ağacı başına: doğum ↔ pasife-aktife alma · bayi bağı |
| 9106 | `TRANSFER_KEY` | taşıma talebinin yeni anahtarı başına |
| 9107 | `UPLOAD_REQUEST` | yükleme isteği başına: kota ↔ tamamlama/terk ↔ iptal |
| 9108 | `UPLOAD_SESSION` | yükleme oturumu başına: tamamlama ↔ terk |
| 9109 | `SHARED_FILE` | paylaşılan dosya başına: gövde budaması ↔ bağlantı doğumu |
| 9110 | `DOWNLOAD_LINK` | indirme bağlantısı başına: sayaç ↔ iptal |
| 9111 | `KEY_SET` | imza anahtarı kümesi: iptal belgesi içe aktarma ↔ süre bildirimi |
| 9112 | `UPDATE_WAVE` | güncelleme grubu başına: dalga açma ↔ ilerletme/geri çekme ↔ eşik |

## Budama beyanı (telemetri + ayak izi)

Yaşa göre silinen tablolar YALNIZ `src/services/maintenance.ts` `PRUNED_MODELS`te beyanlıdır (nonce · yoklama · portal oturumu/işlemi · denetim · hata raporu); hiçbir iş kararı bunları okumaz; başka her silme yasak, bekçi ölçer. Defterler tetikleyiciyle değişmez. Gövde budaması satırı silmez (`BODY_PRUNED_MODELS`, olay `dagitim_defteri`nde). Süreler ve tam liste `MIMARI.md`.

## Alt-alan kuralları — dokunmadan önce oku

Kural `docs/kurallar/lisans.md` § Satıcı sunucusu; anlatım `MIMARI.md` § Alt-alan anlatımı (aynı adlı `###` başlık): Kurulum kaydı + destek · VDS kurulumu · İç API · Kira zinciri · Parmak izi v2 · Modül anahtarı kasası · Hız ve vekil · Bildirimler · Portal · Dağıtım · Güncelleme dalgası · ERİŞİM · Anahtar hiyerarşisi. Kural satırı bekçi adından bulunur.

## Komutlar

```bash
cd satici/sunucu
npx prisma migrate deploy && npx prisma generate      # migrate dev/reset YASAK (yeni migration: migrate diff)
npm run typecheck && npm run typecheck:scripts && npm run lint
node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts [ad-parçası]   # yalnız *_test DB
```

`.env` repoya girmez (0600); `DATABASE_URL` kendi `_test` DB'si (`tekserp_fabrika_*` ASLA). Göndericinin sırları yan konteynerde. Tam liste, CLI'ler, CI `MIMARI.md` § Komutlar.
