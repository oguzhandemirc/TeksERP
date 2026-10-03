# satici/sunucu — TeksERP satıcı (lisans) sunucusu

> Kök `CLAUDE.md` çekirdeği burada da AYNEN geçerlidir (defter semantiği, atomik claim, advisory kilit tx'in ilk ifadesi, fail-closed kapı, `details.code`, TR mesaj, sır hijyeni). Plan: Kod Koruma + Lisanslama (Faz 1b). Sözleşme: `docs/design/LISANS-PROTOKOLU.md`.
> Bu dosya yalnız satıcı sunucusunun HER değişikliğinde geçerli çekirdeği taşır; alt-alan kuralları `docs/kurallar/lisans.md`'de (dizin: § Alt-alan kuralları), anlatım parçaları (dinleyici ortamı, şema, CLI'ler, ortam değişkenleri) `satici/sunucu/MIMARI.md`'de. Alanın kimlikli kuralları: `docs/kurallar/lisans.md` § Satıcı sunucusu · bekçiler: `Teks-Erp/docs/BEKCI-HARITASI.md` § lisans.

## Amaç

Fabrikaların lisansını verir ve yönetir: **etkinleştirme** (tek kullanımlık kod → HAK + KİRA; kimliksiz istekte kurulumu KOD belirler, yanıt lisans kimliğini taşır — D14), **yoklama**, **kapı zili** (SSE; içerik taşımaz, "şimdi yokla" der; kurulum başına ≤ `ZIL_AZAMI_ABONE`), **çevrimdışı/QR**, **taşıma** (yeni makine yalnız TALEP açar; satıcı onayı tek kullanımlık `tasima` kodu üretir, anahtar kodla etkinleşmede değişir — D8), **DR devralımı**, **yaptırım**, **portal JSON API'si**. Ayrıntı: `satici/sunucu/MIMARI.md` § Amaç.

## Katmanlar

| Katman | Yer | Kural |
|---|---|---|
| Protokol | `src/lisans-protokol/` | `Teks-Erp/src/lib/license/protocol/` klasörünün **BAYT-EŞİT aynası**. Burada DÜZENLENMEZ: değişiklik önce Teks-Erp'te, sonra kopya. Bekçi `Teks-Erp/scripts/test_lisans_protokol_aynasi.ts` |
| Anahtar | `src/keys/` | Kök/bayi/HAK ara imzacısı parolalı (scrypt + AES-256-GCM; AAD türü bağlar — `*.kok.json` · `*.bayi.json` · `*.ara.json`, uzantı-tür uyuşmazsa yüklenmez); parola YALNIZ imza alt sürecinin stdin'ine (argv/env ASLA), Buffer iş bitince sıfırlanır. ALT/İNDİRME 0600, kök imzalı sertifikalı; emekli anahtar yalnız açık yarı + sertifika (`*.sertifika.json`, künyede EMEKLI). Çapa: gömülü `ROOT_PUBLIC_KEYS` (hazırlık kökü `hazirlik-2026-1` yalnız TEST/DEMO + üretim kökü `kok-2026-1` bütün sınıflar, 2026-09-30 töreni); `GUVEN_CAPASI_DOSYASI` yalnız test |
| Servis | `src/services/` | İş kuralı + tx. Durum geçişi atomik claim (`updateMany WHERE {id, beklenen}` + `count===0 → 409`); `tx.*` `Promise.all`'a girmez |
| HTTP | `src/http/` | Genel dinleyici: `/v1/*` + `/q` + `/bayi/api` (yalnız BAYI) + bayi arayüzü `/bayi`. Tailnet dinleyicisi: `/portal/*` (soket + kaynak ağı kapısı, fail-closed 404; geri döngü yalnız `TAILNET_LOOPBACK=1` iken) + satıcı arayüzü `/portal` (kapının ARKASINDA). İç dinleyici: YALNIZ `/ic/v1/*` (patron bulutu; soket + kaynak ağı + Bearer, aşağıda). ERİŞİM dinleyicisi: satıcı portalının internetten yolu (aşağıda). Web arayüzü `PORTAL_WEB_DIZINI`den (varsayılan `../web/dist`); dinleyici yalnız KENDİ uygulamasını sunar, `/api` altı HTML'e düşmez, derlenmemişse 404 (bekçi `test_portal_web_statik`). `/v1` gövdesi ham baytlarıyla alınır (imzalı özet) ve KATI şemadan geçer. `/v1` sırası: IP hız sınırı → KATI şema → imza → uca özgü ön denetim → kurulum hız sınırı → nonce → kilit/tx (reddedilecek istek nonce/kilit tüketmez; bekçi `test_genel_dinleyici`) |
| Portal | `src/portal/` + `src/http/portal-*.ts` · `dealer-routes.ts` | Rota TABLOSU veridir: her rota izin (`roles.ts`) + kimlik beyanı taşır; yazma `executePortalAction` (işlem kimliği + eylem + denetim tek boğaz). Oturum: parola scrypt + TOTP ZORUNLU tek adım, çerez httpOnly + SameSite=Strict, oturum doğduğu dinleyiciye bağlı |

- **Tek süreç, dört dinleyici** (`src/server.ts`; tailnet, iç ve erişim için joker adres açılışta RED): **4610 genel · 4611 portal (tailnet) · 4612 iç API · 4613 portal (erişim, yalnız `PORT_ERISIM` verilirse)**.
- **Sır**: özel anahtar, parola, etkinleştirme kodunun düz metni DB'ye, loga, denetime GİRMEZ. Kod DB'de sunucu sırrıyla (pepper, `ANAHTAR_DIZINI/etkinlestirme-kodu.pepper`) HMAC-SHA256 + son 4 karakter; son 4 YALNIZ `etkinlestirme_kodu.kodSonu`da (denetim ve kurulum kaydı kod kimliğini taşır; `portal_islemi`nin saklanan tekrar yanıtında ne kod ne son 4 var). `.env` ve `anahtarlar/` repoya girmez.
- **Zil:** portal eylemi kendi tx'inde `pg_notify('satici_zil', …)` → COMMIT'te sunucunun PG dinleyicisi aboneye iletir (eylemi yapan süreç sunucu olmak zorunda değil).

Ayrıntı (dinleyici ortam çiftleri, şema): `satici/sunucu/MIMARI.md` § Katmanlar.

## Portal (JSON API)

- **Rol × dinleyici KESKİN:** `SATICI_YONETICI` · `SATICI_OPERATOR` yalnız TAILNET'ten ve ERİŞİM'den (oturum doğduğu dinleyiciye bağlı; ERİŞİM çerezi her zaman Secure), `BAYI` yalnız GENEL'den girer; uymayan hesap bilinmeyen hesap gibi davranır (sayaç değişmez, eşdeğer scrypt işi). İzin tablosu tek kaynak `src/portal/roles.ts`; K4/K5 · geri sayımı 7 günden KISA K3 (planlı ve taksit kısıtlama günü dahil; lisans numarasıyla ikinci onay, ağırlık satıra `agir` olarak donar) · zorlama · kurulum iptali · kanal · bayi · kullanıcı yönetimi yalnız YÖNETİCİ; kullanıcı yönetimi (`kullanici:yonet`, TOTP tohumu ve parola taşır) ayrıca YALNIZ tailnet/geri döngüde (`TAILNET_ONLY_PERMISSIONS`).
- **Giriş:** kullanıcı adı + parola + TOTP (RFC 6238, tekrar oynatma kilidi) TEK adımda; hata iletisi tek; ardışık başarısızlıkta hesap süreli kilit. TOTP sırrı AES-256-GCM ile sarılı (anahtar `ANAHTAR_DIZINI/portal-totp.key`, DB'de değil); kurulumu hesabı açan yönetici yapar, sır yalnız o yanıtta BİR KEZ. İlk yönetici: `scripts/portal-kullanici.ts ekle`.
- **İdempotency:** her yazma `clientToken` taşır; eylem ile `portal_islemi` satırı AYNI tx'te yazılır → aynı kimlik aynı yanıtı alır, eylem ikinci kez koşmaz; başka kullanıcı/eylem/gövde 409 `ISLEM_KIMLIGI_CAKISTI`. Sır alanları gövde özetine ve saklanan yanıta girmez (kod/TOTP tekrarında `…Gosterilemez: true`).
- **Kök/ara/bayi parolası** formdan → imza alt sürecinin stdin'ine (hazırlık tx DIŞINDA), Buffer sıfırlanır; imza yalnız izinli dinleyici kapsamında (kök ve ara: tailnet, bayi: genel) — boğaz `signWithWrappedKey`. Kullanıcı başına ardışık `IMZA_PAROLA_ESIGI` (5) hatada `IMZA_KILIT_DK` (15) dk imza kilidi (girişten ayrı; 429 `IMZA_PAROLASI_KILITLI`), her başarısız deneme denetimde (`IMZA_PAROLASI_BASARISIZ`); imza alt süreci `IMZA_ESZAMANLI` (1–2) slotlu semafordan geçer (D11). HAK'ın yapısal değişikliği (modül tavanı · kalıcı · bakım) yalnız YENİ İMZALI SÜRÜMLE olur; `production.enabled` varsayılan dahil, çıkarılırken açık onay (`URETIM_MODULU_UYARISI`).
- **Hata kodları — tek kaynak iki liste:** fabrikanın da gördüğü kodlar protokolün `VENDOR_ERROR_CODES` / `PROTOCOL_ERROR_CODES`inde yaşar (`GOVDE_GECERSIZ` 400 · `BULUNAMADI` 404 — bilinmeyen yol ve portalda "kayıt yok" · `TEKRAR_DENEYIN` 409 — PG 40001/40P01 ve atomik claim kaybı, aynı istek yeniden denenir · `SUNUCU_HATASI` 500 · …). Portal kodları (`src/lib/errors.ts` `PORTAL_ERROR_CODES`, yalnız `/portal/api` · `/bayi/api`): `OTURUM_YOK` 401 · `GIRIS_BASARISIZ` 401 (kilitli hesap da — bilinmeyen hesapla aynı yanıt) · `YETKISIZ` 403 · `DURUM_CAKISMASI` 409 · `IKINCI_ONAY_GEREKLI` 400 · `ISLEM_KIMLIGI_CAKISTI` 409 · `BAYI_TAVANI_ASILDI` 409 · `URETIM_MODULU_UYARISI` 409 · `IMZA_PAROLASI_HATALI` 400 · `IMZA_PAROLASI_KILITLI` 429 · `PAROLA_ZAYIF` 400 · `KULLANICI_ADI_KULLANIMDA` 409 (ön okuma da, yarışın UNIQUE ihlali de). Genel tekillik ihlali (P2002) 409 `TEKRAR_DENEYIN`dir, 500 değil. İki liste KESİŞMEZ (bekçi `test_satici_kapilari` §8); `/v1/*` yalnız protokol kodlarını döndürür. İç API kodları üçüncü liste (`INTERNAL_ERROR_CODES`: `IC_KIMLIK_GECERSIZ` 401), ikisiyle de kesişmez (§8d).

## Advisory kilit envanteri (satıcı DB'si — backend'in 80xx uzayından bağımsız)

Kilit tx'in İLK ifadesidir; birden çok kilit bu SIRADA alınır: `PORTAL_TOKEN → DEALER` (kimlik sırasıyla, `lockDealers`) `→ CUSTOMER → TRANSFER_KEY → INSTALLATION` (kimlik sırasıyla, `lockInstallations`) `→ LICENSE_NUMBER → UPLOAD_REQUEST → UPLOAD_SESSION` (istek → oturum tek yardımcıda, `lockUploadScope`) `→ SHARED_FILE → DOWNLOAD_LINK → KEY_SET`. Tek tanım `src/lib/locks.ts` `LOCK_NAMESPACES`; bu tablo onunla birebir, sıra da ölçülür (bekçi `scripts/test_satici_kapilari.ts` §1, §7).

| Uzay | Ad | Kapsam |
|---|---|---|
| 9101 | `INSTALLATION` | kurulum başına: etkinleştirme · yoklama/kira · taşıma · DR · yaptırım · HAK sürümü · kod üretimi |
| 9102 | `LICENSE_NUMBER` | lisans numarası sayacı (`TKS-YYYY-NNNN`, yıl başına) |
| 9103 | `DEALER` | bayi başına: tavan değişimi · bayi imzalı HAK · bayinin kurulum adedi |
| 9104 | `PORTAL_TOKEN` | portal işlem kimliği (clientToken) başına: aynı kimlikli eşzamanlı denemeler sıraya girer |
| 9105 | `CUSTOMER` | müşteri ağacı başına: tesis/kurulum doğumu ↔ müşteri/tesis/kurulum pasife-aktife alma (MV-06) · müşterinin bayi bağı (bayi sahipliği bu kilit altında okunur — D10) |
| 9106 | `TRANSFER_KEY` | taşıma talebinin yeni anahtarı başına: kimliksiz (kurulumsuz) talebin doğumu ↔ kararı (D8) |
| 9107 | `UPLOAD_REQUEST` | yükleme isteği (/y) başına: kota rezervasyonu/iadesi ↔ oturum tamamlama/terk ↔ iptal |
| 9108 | `UPLOAD_SESSION` | yükleme oturumu başına: tamamlama ↔ terk (parça yazımı UNIQUE ile idempotent) |
| 9109 | `SHARED_FILE` | paylaşılan dosya başına: gövde budaması ↔ paylaşım bağlantısı doğumu |
| 9110 | `DOWNLOAD_LINK` | indirme bağlantısı (/d) başına: indirme sayacı ↔ iptal |
| 9111 | `KEY_SET` | satıcının imza anahtarı kümesi (tek anahtar): iptal belgesi içe aktarma (`sira` tekdüze artar) ↔ anahtar süresi bildirimi taraması |

## Budama beyanı (telemetri + ayak izi)

Yaşa göre silinen tablolar YALNIZ (`src/services/maintenance.ts` `PRUNED_MODELS`): `nonce_defteri` (`sonKullanim` = istek zamanı + 10 dk geçti) · `yoklama` (`YOKLAMA_SAKLAMA_GUN`) · `portal_oturumu` (bitişinden/kapanışından `PORTAL_OTURUM_SAKLAMA_GUN` sonra) · `portal_islemi` (işlem kimliği; `PORTAL_ISLEM_SAKLAMA_GUN`) · `denetim` (ayak izi, günde bir, iki sınıf tek tx'te: `PORTAL_GIRIS_BASARISIZ`/`PORTAL_GIRIS_REDDEDILDI` `DENETIM_GIRIS_SAKLAMA_GUN` = 90, diğer her satır `DENETIM_SAKLAMA_GUN` = 730; bekçi `test_denetim_budama`). Hiçbir iş kararı bunları okumaz (zincir kararı `kira`dan, güncel sağlık `kurulum.sonSaglik`ten, eylemin kendisi kendi defterinden). Başka her silme yasak; bekçi ölçer. Defterler (tetikleyiciyle değişmez): `hak_surumu` · `kira` · `yaptirim_eylemi` · `kurulum_kaydi` · `bayi_tavani` · `dagitim_defteri` · `yayin_bildirimi` · `destek_olayi` · `iptal_belgesi`.

**Gövde budaması (satır SİLİNMEZ):** `dagitim_dosyasi` (`src/distribution/retention.ts` `BODY_PRUNED_MODELS`) — saklama süresi (`DOSYA_SAKLAMA_GUN`) dolan dosyanın DİSK GÖVDESİ silinir; satır kalır (`govdeBudandiAt` durum kolonu), olay `dagitim_defteri`nde `GOVDE_BUDANDI`. Yarım yükleme: `YUKLEME_TERK_SAAT` boyunca parça gelmeyen oturum TERK (kota iadesi, parçalar silinir, `YUKLEME_TERK`). Bekçi `test_dagitim_budama`.

## Alt-alan kuralları — dokunmadan önce oku

2026-10-03'te `docs/kurallar/lisans.md` § Satıcı sunucusu — alt-alan kuralları altına aynı adlı `###` başlıklarla kelimesi kelimesine taşındı; o alt alana dokunan oturum önce ilgili başlığı okur.

- **Kurulum kaydı + destek (3d-2)** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — Kurulum kaydı + destek (3d-2)
- **VDS kurulumu** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — VDS kurulumu
- **ERİŞİM** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — ERİŞİM
- **İç API** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — İç API
- **Anahtar hiyerarşisi** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — Anahtar hiyerarşisi
- **Kira zinciri** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — Kira zinciri
- **Parmak izi v2** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — Parmak izi v2
- **Modül anahtarı kasası** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — Modül anahtarı kasası
- **Hız ve vekil** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — Hız ve vekil
- **Bildirimler (giden kutusu + yan konteyner)** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — Bildirimler (giden kutusu + yan konteyner)
- **Portal (JSON API)** (bayi sahipliği · bayi imzalı HAK · kanal) — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — Portal (JSON API)
- **Dağıtım (Faz 3d)** — bu bölüme dokunmadan önce oku: `docs/kurallar/lisans.md` § Satıcı sunucusu — Dağıtım (Faz 3d)

## Komutlar

```bash
cd satici/sunucu
npx prisma migrate deploy && npx prisma generate      # migrate dev/reset YASAK (yeni migration: migrate diff ile üret)
npm run typecheck && npm run typecheck:scripts && npm run lint   # commit kapısı dördüncü proje olarak aynısını ölçer (tip + eslint + lint-baseline.json tavanı)
node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts [ad-parçası]   # yalnız *_test DB
```

`.env` (repoya girmez, 0600): `DATABASE_URL` (kendi `_test` DB'si; `tekserp_fabrika_*` ASLA) · `IC_API_BELIRTEC_DOSYASI` (0600/0640 sır dosyası; repoya girmez) · `YAYIN_DIZINI` (salt-okunur) · (yalnız test) `GUVEN_CAPASI_DOSYASI`; tam liste MIMARI'de. Göndericinin ortamı (kanal sırları · hedefler) satıcının `.env`inde DEĞİL, yan konteynerde (`sender-config.ts`). Anahtar/kullanıcı CLI'leri, tam ortam listesi, CI: `satici/sunucu/MIMARI.md` § Komutlar.
