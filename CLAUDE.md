# TeksERP — Monorepo Kökü

> Her oturumda yüklenir; yalnız ÇEKİRDEK'i ve alan haritasını taşır. Alan kuralları `docs/kurallar/<alan>.md` (dokunmadan ÖNCE oku), karar hikâyeleri `docs/history/arsiv/<YYYY-MM>.md`. Kısaltma turları: 2026-10-03 (`a61efbd21`), 2026-10-12 (`8eae71115`; çıkarılan anlatılar arşiv notu "Kök CLAUDE.md kısaltma turu").
>
> **Tek gövde, çok fabrika:** [ÇEKİRDEK] her kurulumda aynıdır (defter, brüt sevk, idempotency, kilit sırası, atomik claim, fail-closed, sır hijyeni, veri bütünlüğü); [PROFİL] bayrak/veriyle değişir (rota, istasyon topolojisi, modüller, sayısal ayarlar). Ölçüt: `docs/design/MODUL-BAYRAK-TASARIM.md` §0, §11, §12.

Tekstil fabrikası ERP'si; her alt projenin kendi `CLAUDE.md`'si var:

| Proje | Stack | Port |
|---|---|---|
| `Teks-Erp/` | Express 5 + Prisma 7 + PostgreSQL backend | 4000 |
| `Electron/` | Electron 42 + React 19 + Vite yönetim paneli (admin frontend; `React/` yok) | 5174 |
| `mobil/` | Expo 54 Android tablet (yatay) + telefon (dikey) — saha | — |
| `satici/` | Lisans sunucusu + portal; VDS'te, fabrikaya kurulmaz | 4610 · 4613 |
| `patron/` | Patron bulutu sunucusu; VDS'te; tesis başına ayrı DB | 4620 |
| `patron/uygulama/` | Expo 54 patron uygulaması (tel tipleri `patron/sunucu/src/wire/api.ts`in bayt-eşit aynası) | — |
| `Teks-Erp/native/lisans-cekirdek/` | Rust + napi-rs lisans çekirdeği (`.node`, backend paketinde) | — |

**Dallanma:** `feature/*` → `main`; müşteri dalı YOK, fark yalnız bayrak profilinde; `if (musteri === 'X')` yasak; sürüm başına TEK paket (`genel.md`). Üretim akışı (referans profil) ve "rota adımı mı, ayrı varlık mı" ölçütü: `docs/README.md` § Üretim akışı.

## Çekirdek değişmezler

### Veri ve defter
- PRODUCTION canlı ve tekil değil: `migrate reset` / reseed / toplu `DELETE` yasak; migration geri alınamaz; düzeltme script'i dry-run varsayılan, `--apply` öncesi kaydı listeler; şema provası en eski canlı dump'ta (`deploy-kurulum.md`).
- Her modelde UUID PK + `createdAt`/`updatedAt`; `DateTime` → `@db.Timestamptz`, UUID → `@db.Uuid`. Fabrika günü ve HER görüntü/basım saati fabrika dilimindendir, tek kaynak `src/constants/time.ts` (istemcide `src/lib/factory-time.ts`); dilim tarihli dönemler defteridir, geçmiş etkilenmez; çıplak `DATE_TRUNC`/`AT TIME ZONE`/dilim literal'i yasak (`raporlar.md`).
- DEFTER-ÖNCELİKLİ: durum tablosu "şu an ne", defter "ne oldu" — "ne oldu" asla değişmez. Yalnız soft delete; hard delete iki sınıf (saf yapılandırma pivotu replace'i · deftere hiç yazmamış taslak); diğer her "sil" DURUM GEÇİŞİDİR. Defter testi: satır silinince raporlanan sayı değişmiyorsa DEFTER DEĞİLDİR (audit arşivlenir, telemetri bekçi izniyle budanır) — `defter.md`.
- Her CUD → `AuditService.log()`; muafiyet `AUDIT_EXEMPT_MODELS`te beyanlı; audit best-effort, tx DIŞINDA ve yalnız AYAK İZİDİR: `SystemLog`dan karar/sayı/durum türetilmez (`test_audit_okuma_kaynagi`).
- Sevk rakamı HER yüzeyde BRÜT; iade ayrı belgeyle; storno ≠ iade. Defter kronolojisi `createdAt` (belirlenimli artar; "en son" okuyucusu eşitlik bozucusuz yazılmaz); ters kayıt bugüne; ileri kaynağın `scripts/lib/defter-beyan.ts`te beyanlı ters MEKANİZMASI olur; geri alma ileri kaydı ne siler ne değiştirir — `defter.md`, `sevkiyat.md`.
- Beş sağlamlık sınıfı (iki tarih · ters yol · kilit sırası · çift yüklem · tek kaynak satır) — `finans.md`. Ölü top kümesi `K18_DEAD_STATUSES`; `finalizedAt`/`statusChangedAt` damgasını DB trigger'ı yazar.
- Yıkıcı işlemde backend preview ucu, arayüz etkilenen HER kaydı listeler, per-record seçim. Validation mesajı Türkçe; i18n kurulmaz.

### Eşzamanlılık
- Durum geçişi ATOMİK CLAIM: `updateMany WHERE {id, beklenen-durum}` + `count===0 → 409`; `findUnique→if→update` yasak; `tx.*` + `Promise.all` yasak.
- Advisory kilit tx'in İLK ifadesi; her uzayın TEK sahibi, envanter `helpers/period-guard.helper.ts` başlığında, `test_advisory_lock_namespaces` ölçer (`docs/standart/ESZAMANLILIK.md`); çok kilit deterministik sırada; PG 40P01/40001 → 409.
- Durum ↔ sayaç çiftinde iki yazar da karşı koşulu atomik WHERE'ine koyar + DB CHECK seddi.
- İdempotency: kayıt yaratan uç `clientToken @unique`; token MANTIKSAL DENEME başına, yalnız belirsiz hatada (ağ/zaman aşımı/5xx) yapışır; replay dört durumlu, TEK boğaz `helpers/token-replay.helper.ts` (`kk1.md`).

### Tek kaynak ve ayrışan yüzey
- Aynı soruyu cevaplayan koşul TEK helper'da, AST bekçisi korur; bellek-içi yüklem ↔ Prisma parçası boğaz-ikizdir (`stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE`).
- Liste + cursor + özet şeridi tek where'den; süzme SUNUCUDA; id filtresi `readIdCondition`/`readFilterList`'ten (`filtre-liste.md`).
- Enum değeri, bayrak, route+izin eklemek reçeteli iştir (`docs/RECETELER.md`); istemci gövde katmanı sessiz allowlist'tir — alan iki uçta eklenir; müşteri belgesinde iç kolon OPT-IN.
- `BaseController` modelinde yeni SKALER kolon aynı anda YAZILABİLİR ALANDIR — olmamalıysa açıkça kapat (`docs/standart/BACKEND-HTTP.md`).
- Numara DOĞUŞTA materyalize edilir; biçim `number_series` tablosunda, değişim yalnız yeni elemanı etkiler (`numaralandirma.md`).
- Master veride KİMLİK ile ROL ayrılır (rol bayraktır); cari hesap tek kimliğe, XOR'lu çift bağ yasak; canlı referanslı ana veri pasife alınamaz (`docs/standart/MASTER-VERI-TASARIMI.md`).

### Kapılar ve sözleşme
- FAIL-CLOSED: tanınmayan kapsam 400, çözülemeyen şablon 400/404, izin guard'ı anahtar-kapsamlı, önbellekte TTL tazeliktir geçerlilik değil.
- Hata kodu `details.code` (`body.code` hep undefined); kapalı modül 403 `MODULE_DISABLED`; `clientType` güvenlik sınırı değil. Müşteri yerindeki sunucuya GELEN port açılmaz (HTTPS 4443, API 127.0.0.1); bizim bulut/demo sunucumuz istisna (`kesif-cihaz.md`).
- Yetenek "VAR" = motor + çıkış yüzeyi + izin ataması; izin kataloğu koda, atama panele; SoD kümesi (`shipping:invoice`, `shipping:undo-dispatch`, `roll:manual-adjust`, `gelen-belge:approve`) yalnız Muhasebe/Süpervizör; süperadmin rol değil (`yetki-izin.md`).
- Yeni bayrağın varsayılanı = BUGÜNKÜ davranış (ölçülerek); çıkışsız kapı üreten bayrak açılmaz. Rota kapsaması kategoride UYARIR (`ApiResponse.warnings`), özellikte sert (`rota-renk.md`).
- Lisans kapısı fabrikayı aniden durdurmaz; veri erişimi hep açık (`lisans.md`). Dışarı giden her istek kurulum anahtarıyla imzalanır; bulut hesap yapmaz (`patron-bulutu.md`).
- İş emri yalnız üretimi yönetir; tartı/paket/sevkiyat çuvala bağlanır; top↔sipariş bağı yok, karşılama `SackAllocation` ile sevk anında (`is-emri.md`).

### Dağıtım, süreç, sır
- Backend ÖNCE, panel + tablet sonra; sözleşme kıran değişiklikte "eski istemci ne yapar" cevaplanır; `minVersion` yalnız gerçek kırılmada. Sürüm notu taslağını Claude yazar, kullanıcı TERFİDE onaylar; müşteri kodu argümandan, kanal kimliği `deploy/kanallar.json` (`surum-yayin.md`). Commit edilmemiş migration prod'da sessiz eksiktir (`deploy-kurulum.md`).
- Backend TEK process: `pkill -f "tsx src/server.ts"` yasak, ikinci Node süreci yasak. Donanım polling backend'e girmez; uydurulmuş değer `source:'SIMULATED'` ile gider (`kesif-cihaz.md`).
- Sır hijyeni: parola/PIN/TOTP/ayar şifresi repoya, log'a, sürüm notuna, audit yüküne girmez; `quickPin` ve kart kodu DB'de yalnız HMAC özeti (`superadmin.md`). Yeni paket eklemeden önce onay.
- Karar notu arşive + ilgili `kurallar/<alan>.md`'ye TEK kural satırı (emir kipi; gerekçe arşivde); iptal edilen kural silinir, arşive "GEÇERSİZ → tarih". Kod yorumu 1–3 satır NEDEN söyler.

## Yasaklar

Tam liste `docs/KOD-KURALLARI.md` § Yasaklar (mekanik olanlar `Teks-Erp/eslint.config.mjs` + kapı mandalları). En çok ısıranlar: `migrate dev` düz koşum (yalnız `--create-only`, `DropForeignKey` satırları silinir) · route/controller'da `prisma` import · `notIn: []` · `body.code` okumak · `toLocaleUpperCase("tr")` · yeni izin kodu için migration · davranış bayrağını profile koymak · süperadmin kimliğini JWT'ye koymak.

## Alan dizini — dokunmadan önce `docs/kurallar/<alan>.md`

defter · sevkiyat · fason · tambur · top-duzeltme · kk1 · kursun · is-emri · rota-renk · kalite · dokuma · parti · yari-mamul · refakat-karti · belge-etiket · gelen-belge · bildirim · mukerrer · numaralandirma · sebep-katalogu · kesif-cihaz · surum-yayin · deploy-kurulum · modul-bayrak · superadmin · yetki-izin · filtre-liste · raporlar · finans · maliyet · patron-bulutu · lisans · genel. Özetler `docs/kurallar/README.md`; belge haritası `docs/README.md`.

## Çalışma düzeni

- Döngü, test DB aracı, kapı kurgusu, ağır koşum, alt ajan istem şablonu: `docs/GELISTIRME-DONGUSU.md`. Ana ağacın `.env`i FABRİKA VERİSİDİR — bekçi koşulmaz, kopyalanmaz; oturum `node scripts/test-db.mjs ac tekserp_<oturum>_test` açar.
- Ajan yalnız kendi alanının bekçilerini koşar (`/bekci-kos <alan>`; harita `Teks-Erp/docs/BEKCI-HARITASI.md`); tam set CI'da (push → yeşil → iniş). Yeni bekçi negatif sondayla doğrulanır (`docs/RECETELER.md` § Yeni bekçi).
- Commit kapısı `node scripts/hooks-kur.mjs` (izole worktree'de koşar); yeni mandal kendi dosyalarına, yeni dosya dizinin bütün tarayıcılarına koşturulur; kaçış yalnız `TEKSERP_HOOK_SKIP=1`.
- İş kapanınca (commit/push · sürüm · alan değişimi) `/clear`; tarama işi alt ajana. Model her işte Opus/Fable, Sonnet yok (kullanıcı kararı 2026-10-12).

## Compact instructions

- Koru: dal + son SHA, değişen dosya listesi, koşulan bekçiler ve kırmızılar, test DB adı, açık kararlar, sıradaki adım.
- At: dosya içerikleri, araç çıktıları, geçmiş hata metinleri (yalnız sonucu kalır).
- PLAN dosyası varsa yolunu tut, metnini taşıma.
