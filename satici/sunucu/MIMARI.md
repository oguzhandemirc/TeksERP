# satici/sunucu — mimari ve ayrıntı

> `satici/sunucu/CLAUDE.md`'den 2026-10-03'te taşınan açıklayıcı metin: çekirdekte KALAN bölümlerin anlatım parçaları (amaç ayrıntısı, şema, dinleyici ortamı, CLI'ler, ortam değişkenleri). Oturum açılışında yüklenmez. Kurallar `satici/sunucu/CLAUDE.md`'de; alt-alan bölümleri `docs/kurallar/lisans.md` § Satıcı sunucusu — alt-alan kuralları'nda eski metinleriyle TAM durur ve burada tekrarlanmaz. Başlıklar eski CLAUDE.md bölüm başlıklarıyla aynıdır.

## Amaç

- **Yoklama:** kira yenileme + kira zinciri kararı + indirme belirteçleri.
- **DR devralımı:** self-servis + anında bildirim.
- **Yaptırım:** K0–K5, zorlama, geçerlilik bitişi, planlı eylem, taksit.
- **Portal JSON API'si:** satıcı: tailnet `/portal/api` ve internetten ERİŞİM `/portal/api` — Cloudflare Access arkası · bayi: genel `/bayi/api`.
- **Portal web arayüzü** `satici/web`'dedir (kendi `CLAUDE.md`'si); derlenmiş çıktısını bu sunucu API ile AYNI kökenden sunar (`src/http/web-static.ts`).

## Katmanlar

- **Şema** (`prisma/`): Müşteri → Tesis → Kurulum → Hak; defterler (`hak_surumu`, `kira`, `yaptirim_eylemi`, `kurulum_kaydi`, `destek_olayi`) DB tetikleyicisiyle değişmez; telemetri (`nonce_defteri`, `yoklama`) yaşa göre budanır. Kural hâli (üst küme) CLAUDE.md § Budama beyanı'nda.
- **Tek süreç, dört dinleyici:** ortam çiftleri `PORT_GENEL`/`GENEL_BIND` + `PORT_TAILNET`/`TAILNET_BIND` + `PORT_IC`/`IC_BIND` + `PORT_ERISIM`/`ERISIM_BIND`. Portlar `.env.example` ile aynı; yerel oturum ağacı başka port seçebilir, bekçiler port 0'da kalkar.

## Komutlar

```bash
cd satici/sunucu
npx prisma migrate deploy && npx prisma generate      # migrate dev/reset YASAK (yeni migration: migrate diff ile üret)
npx tsx scripts/anahtar.ts kok-uret --kid=hazirlik-2026-2  # parola TTY/stdin; alt-uret · indirme-uret · bayi-uret · ara-uret · iptal-uret · kuyruk-imzala (ÜRETİM kümesi ve dönemler: deploy/satici/uretim-toren.mjs [donem])
# VDS (konteyner, DB'li): anahtar.js kuyruk-disa-aktar > kuyruk.json · anahtar.js donem-ice-aktar < ice-aktar.json · anahtar.js emekliye-ayir --kid=… [--uygula]
npx tsx scripts/portal-kullanici.ts ekle --kullanici=ad --ad-soyad="Ad Soyad" --rol=SATICI_YONETICI  # ilk yönetici (parola TTY/stdin; TOTP sırrı BİR KEZ basılır)
npm run typecheck && npm run typecheck:scripts && npm run lint   # commit kapısı dördüncü proje olarak aynısını ölçer (tip + eslint + lint-baseline.json tavanı)
node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts [ad-parçası]   # yalnız *_test DB
```

`.env` (repoya girmez, 0600): `DATABASE_URL` (kendi `_test` DB'si; `tekserp_fabrika_*` ASLA) · `PORT_GENEL` · `TAILNET_BIND` · `PORT_TAILNET` · `ANAHTAR_DIZINI` · `PORTAL_WEB_DIZINI` (derlenmiş `satici/web` çıktısı; varsayılan `../web/dist`) · (genel portal için) `PORT_ERISIM` · `ERISIM_BIND` · `CF_ACCESS_TAKIM_ALANI` · `CF_ACCESS_AUD` · `CF_ACCESS_JWKS_DOSYASI` · (iç API için) `PORT_IC` · `IC_BIND` · `IC_KAYNAK_AGLARI` · `IC_API_BELIRTEC_DOSYASI` (0600/0640 sır dosyası; repoya girmez) · `DOSYA_DIZINI` · `DERLEME_DIZINI` · `YAYIN_DIZINI` (salt-okunur) · (yalnız test) `GUVEN_CAPASI_DOSYASI`; saklama süreleri, bildirim eşikleri (`BILDIRIM_*`) ve diğer isteğe bağlılar `.env.example`te. Göndericinin ortamı (kanal sırları · hedefler) satıcının `.env`inde DEĞİL, yan konteynerde (`sender-config.ts`). Bekçiler `scripts/test_*.ts`; harita `Teks-Erp/docs/BEKCI-HARITASI.md` § lisans. CI'da ayrı "Satıcı" job'ı (PG 16, `migrate deploy`, lint + tavan + tip + kapı kapsamı + bekçi koşucusu).
