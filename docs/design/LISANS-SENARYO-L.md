# Senaryo L — lisans uçtan uca (L1…L29) sonuç tablosu

> **Durum:** 2026-09-29, W2 dalgası, `lisans/entegrasyon` (W1 dilimleri inmiş hâli) + bu dilimin düzeltmesi, dal `lisans/senaryo-l`. Plan §8 "Senaryo L" adımları SIRAYLA koşuldu.
> **Sonuç:** 26 yeşil · 3 kısmi (L15, L18, L25) · 0 kırmızı. Senaryo Y aynı komutta 23/0 (+1 beyanlı atlama: Y6d thinkpad-1).
> **Entegrasyon koşumu (2026-09-29, W2 entegrasyonu):** `lisans/entegrasyon` üzerinde senaryo-l + satıcı tamamlama + portal web (1f) + hazırlık kökü + 2a ölçümü + B1 tasarımı birlikte: **aynı sonuç** — 26 yeşil · 3 kısmi (L15, L18, L25) · 0 kırmızı; Senaryo Y 23/0 (+Y6d). Koşucu iki satıcı kuralına uyarlandı (Bulgu 6).
> **F1b koşumu (2026-09-29, `lisans/f1b-kapi`, kapı önce 401):** aynı sonuç — 26 yeşil · 3 kısmi (L15, L18, L25) · 0 kırmızı; L28 yeni beklentiyle (401 önce, `LICENSE_GATE` yalnız kimlik istemeyen uçta) yeşil; Senaryo Y 23/0 (+Y6d).
> **Koşucu:** `Teks-Erp/scripts/senaryo-lisans.ts` · L + Y tek komut `Teks-Erp/scripts/senaryo-ly.ts` · kural satırı `docs/kurallar/lisans.md` · arşiv notu 2026-09-29 "Senaryo L (lisans uçtan uca) koşucusu".

## Nasıl koşulur

```bash
cd Teks-Erp
DATABASE_URL='postgresql://…/<ana>_test?schema=public' \
SENARYO_DR_DATABASE_URL='postgresql://…/<dr>_test?schema=public' \
SENARYO_BAYI_DATABASE_URL='postgresql://…/<bayi>_test?schema=public' \
SATICI_DATABASE_URL='postgresql://…/<satici>_test?schema=public' \
PG_BIN_DIR=<sunucuyla aynı ana sürüm pg istemcisi> \
  node ../scripts/agir-is.mjs -- npx tsx scripts/senaryo-ly.ts
```

- Dört DB de `_test` ile biter; üç fabrika DB'si ad + hacim kapısından (`fixtureHedefEngeli` · `hacimHedefEngeli`), satıcı DB'si ad kapısından geçer; `tekserp_fabrika_*` her durumda RED. Fabrika DB'leri migrate edilmiş ve `admin` kullanıcısı olan temiz fikstürlerdir; satıcı DB'si satıcı şemasıyla migrate edilmiştir.
- `--son=L8`: o adımdan sonra durur (hata ayıklama). `--json=<dosya>`: adım sonuçları. `SENARYO_LOG_SAKLA=1`: süreç logları geçici kökte kalır.
- Süre: L ≈ 3 dk, Y ≈ 15 sn (ölçüldü). Çıkış: 0 hepsi yeşil · 1 yeşil olmayan adım var · 2 hedef reddi / düzenek kurulamadı.

## Düzenek (neden böyle)

| Parça | Nasıl |
|---|---|
| Satıcı sunucusu | GERÇEK süreç (`satici/sunucu/src/server.ts`, iki dinleyici 127.0.0.1); anahtar dizini + çapa + portal yöneticisi satıcı kökünde ayrı süreçte kurulur (`satici/sunucu/scripts/lib/senaryo-satici.ts` → `anahtarOrtamiKur`, `portalKullaniciAc`). Teks-Erp betiği satıcı kodunu içe aktaramaz (`rootDir`, ölçüldü TS6059). Kısaltılmış aralıklar: bakım işi 2 sn, kopya penceresi 20 sn. |
| Fabrika backend'leri | GERÇEK `src/server.ts`; giriş `scripts/lib/senaryo-lisans-sunucu.ts` yalnız iki test enjeksiyonu yapar: satıcının test kökleri güven çapası (`configureLicenseRuntimeForTests` — üretimde env'den çapa OKUNMAZ, `ROOT_PUBLIC_KEYS`e dokunulmadı) ve sahte makine kimliği (`ioreg` yanıtı → f1/f4; f5 gerçek PG). Roller: **A** ana (L1–L12) → **C** taşınmış ana (L12–L29) · **B/B2** kopya · **D** DR (ayrı DB) · **E** bayi kurulumu (ayrı DB). |
| "İnternet" | Koşucunun HTTPS aktarıcısı (kendinden imzalı, fabrikaya `NODE_EXTRA_CA_CERTS`) her fabrika için ayrı: **açık** · **kesik** (soket kapanır, zil akışı düşer) · **yut** (satıcı işler, yanıt fabrikaya ulaşmaz — ağ tekrarı). Tel üstündeki gövdeler kaydedilir (L3, L22, L24). Kurumsal proxy: yerel CONNECT vekili (L16). |
| Saat | Her süreç `scripts/lib/senaryo-saat.ts` ile açılır; IPC ile **duvar** (saat sıçraması) ve **monotonik** (gerçekten geçen süre) ayrı kaydırılır. "Dünya" ilerlerken satıcı + çalışan fabrikalar birlikte kayar; L10/L25 yalnız bir fabrikanın duvarını kaydırır. IPC koparsa (koşucu düştü) süreç kendine SIGTERM gönderir — yetim kalmaz, kendi kapanışıyla çıkar. |
| Temizlik | Satıcı tarafı kurulum kimliğiyle (başta çökmüş koşumun artığı, sonda bu koşum), bayi + portal kullanıcıları + anahtar künyesi; fabrika tarafı yazılan modül bayrakları eski değerine. |

## Sonuç tablosu (son koşum)

| Adım | Sonuç | Kanıt (özet) |
|---|---|---|
| L1 portalda (kanal) → müşteri → tesis → kurulum → hak (+ kod) | ✅ | portal `/kanallar` (yoksa 201) `/musteriler` `/tesisler` `/kurulumlar` `/kurulumlar/:id/hak` 201 · `TKS-2026-0001` doğuşta · `/haklar/:id/surum` (kök parolası) 201 sürüm 1 · kod 201 `TKS-XXXX-XXXX-XXXX-XXXX` (16 karakter, P0) |
| L2 etkinleştirme → hak + kira, NORMAL | ✅ | `POST /api/license/etkinlestir` (küçük harf + boşluklu elle yazım) 200 · GECERLI / NORMAL / NORMAL / gözlem · parmak izi ESLESTI 3/3 · portal kurulum ETKIN + anahtar kimliği · zil bağlandı |
| L3 yoklama kirayı yeniler; gövde allowlist | ✅ | yoklama BASARILI, yeni kira · tel üstündeki gövde `PollRequestSchema` (katı) ve `HealthSummarySchema` (katı) geçer · kullanıcı adı / `LICENSE_DIR` yolu / DB adı yok · `sonKiraId` önceki kira |
| L4 K0 → zil → ≤ 5 sn bant | ✅ | portal K0 201 → `hesaplanan.bant.metin` = portal mesajı **124 ms** · gözlemde uygulanan bant null, `/durum.bant` null · geri alma zille yansıdı |
| L5 gözlemde K4 → yazma yine 201 | ✅ | ikinci onaysız K4 → 400 `IKINCI_ONAY_GEREKLI` · hesaplanan KISITLI / uygulanan NORMAL · `POST /api/colors` 201 · `POST /api/orders` kapıdan geçti (400 doğrulama) · "reddederdim" sayacı 0 → 2 |
| L6 zorlama + K4 → sipariş 403 | ✅ | `POST /api/orders` 403 `LICENSE_RESTRICTED` {kademe KISITLI, kisitlamaKalanGun, devredildi} · `GET /api/orders` 200 · `GET /api/import/item/export` 200 · `POST /api/admin/backup` 202 · yedek indirme 200 |
| L7 K5 → giriş + veri-dışarı; geri al ≤ 5 sn | ✅ | `GET /api/orders` 403 `LICENSE_SUSPENDED` · giriş 200 · `/api/auth/me` 200 · `veri-disari` 200 (yönetici) / 403 `PERMISSION_DENIED` (yönetici olmayan — izin guard'ı, kapı değil) · K5'te yedek listesi + indirme 200 · K5 geri alma **140 ms** → KISITLI (K4 sürüyor) · K4 geri alma **121 ms** → NORMAL |
| L8 K2 (finans) → 403 `LICENSE_MODULE`; elle bayrak da 403 | ✅ | `GET /api/finance/cheques` 200 → K2 sonrası 403 {modul `finance.enabled`, neden DONDURULDU} · HAK'ta olmayan `dokuma.enabled` DB'ye elle yazıldı → `GET /api/weaving-orders` 403 LISANSTA_YOK · panel bloğu ikisini listeler · `PATCH /api/feature-flags` açamaz 403 |
| L9 kira biter → EK_SURE → +30 gün KISITLI → yeni kira NORMAL | ✅ | dışarı kesik, dünya +31 gün: EK_SURE `ekSureKalanGun=29`, `/durum` uyarı bandı, yazma açık · +61 gün + başarısız yoklama (iki anahtar) → KISITLI, sipariş 403 · dışarı açık → yeni kira NORMAL |
| L10 saat geri → OLCULEMEDI(SAAT_GERI), yüksek su | ✅ | duvar −10 gün: OLCULEMEDI + SAAT_GERI, güvenilir = monotonik alt sınır (dünya saati), kademe UYARI · `durum.json` silinip yeniden açılış: kaynak **YUKSEK_SU** (+ DURUM_DOSYASI), güvenilir = son kiranın sunucu saati · saat düzelince yeni kira, kayıt yeniden başlar |
| L11 `LICENSE_DIR` kopyası → GECERSIZ + portal uyarısı | ✅ | B: ESLESMEDI (f1, f4) → GECERSIZ `PARMAK_IZI_UYUSMAZ` · portal ACIK uyarı `PARMAK_IZI_UYUSMAZ` + `ZINCIR_CATALI` · asıl sahibi (A) BASARILI + GECERLI |
| L12 taşıma onayı → yeni geçerli, eski düşer | ✅ | C taşıma talebi BEKLIYOR → portal onay 200 → C yoklaması GECERLI + ESLESTI · A (eski anahtar) → `KURULUM_IPTAL` · portalda anahtar C'ninki |
| L13 DR devral → üretim kirası iptal | ✅ | DR kurulumu + hak + kod → D etkinleşti → `dr-devral` 200 GECERLI · portal ana DEVREDILDI + kurulum kaydı · ana (C) zille **810 ms**'de KISITLI + tehlike bandı, indirme belirteci 404 · DR geri al → NORMAL (**bu adım düzeltmeden önce kırmızıydı — aşağıda Bulgu 1**) |
| L14 dışarı kesik → aktarma + QR | ✅ | yoklama `EGRESS_NETWORK` · `aktarma-istegi` → panel (kendi interneti) `/v1/cevrimdisi` 200 → `aktarma-yaniti` yeni kira · QR: `qrAdresi = <satıcı>/q#<zarf>`, `GET /q` 200 HTML, telefon yanıtı base64url → `cevrimdisi-yanit` yeni kira |
| L15 indirme belirteci: Worker doğrulayıcısı | ⚠️ kısmi | belirteç gerçek backend'den (`GET /api/license/indirme-belirteci` 200); Worker'ın kâhini `protocol/indirme.ts`: geçerli ✓ · süresi dolmuş `BELGE_SURESI_DOLDU` · başka kanal/ürün öneki RED · `..` RED · alg none `JWS_ALG` · kurcalı yük `JWS_IMZA`. **Neden kısmi:** CF Worker kodu Faz 3a'da — WebCrypto çalışma zamanı ölçülmedi |
| L16 yerel proxy üzerinden yoklama | ✅ | `PUT /api/license/proxy` 200 (kaynak panel) · yoklama BASARILI + vekilde CONNECT satıcı adresine · kaldırınca doğrudan, yeniden başlatma yok |
| L17 planlı eylem vadesinde K3 | ✅ | portal planlı K3 (vade +12 sn, 7 gün) BEKLIYOR · vadeden önce yaptırım yok · satıcı bakım işi UYGULANDI · fabrika (zil) UYARI + `kisitlamaKalanGun=7` · defterde planlı eyleme bağlı K3 satırı |
| L18 bakım sonrası derleme tarihi → UYARI → EK_SURE | ⚠️ kısmi | fabrika derleme tarihi taşımıyor (`DERLEME_TARIHI_YOK`). **Neden kısmi:** imzalı derleme künyesi Faz 2e'de (`buildEnvironment.derlemeTarihi = null`, runtime `derlemeTarihiMs = null`); kural saf fonksiyonda `test_lisans_durumu §12`'de ölçülü |
| L19 taksit | ✅ | 3 kalemli plan · vade + 15 geçen 1. kalem GECIKTI (K3), vade + 15 dolmamış 2. kalem BEKLIYOR · fabrika K3 geri sayımı 15 gün (plan vadesi geçmiş → EK_SURE) · ödeme → K3 ters kayıtla kalkar, geçerlilik 2. kalem + 15 güne uzar, fabrika kirasında görünür |
| L20 bayi tavan içi HAK → geçerli; aşım → RED | ✅ | portal bayi + tavan (kanal · kalıcı izni · bakım 12 ay) 201 · gerçek CLI `anahtar.ts bayi-uret` (parolalar stdin) + anahtar bağlama · bayi (genel dinleyici) müşteri/tesis/kurulum/hak/imza 201 · fabrika E bayi imzalı HAK'la GECERLI, `hak.bayiId` = bayi · tavan dışı modül ve kurulum adedi → 409 `BAYI_TAVANI_ASILDI` |
| L21 kalıcıya çevir | ✅ | yanlış kök parolası 400 `IMZA_PAROLASI_HATALI` (sürüm artmadı) · doğru parola 201, sürüm 1 → 2 · fabrika yeni HAK'ı aldı: `kalici=true`. Parolanın argv/env'e girmediği `test_kok_parola_argv`'de |
| L22 K1 → belirteç verilmez | ✅ | satıcı yanıtında `indirmeBelirtecleri` 0 · `GET indirme-belirteci` 403 `LICENSE_UPDATES_FROZEN` · `POST /api/colors` 201, `GET /api/orders` 200 · geri alınca belirteç 200 |
| L23 aktarma yanıtı imzasız/kurcalı → RED | ✅ | kurcalı kira (bitiş +1 yıl) 400 `LICENSE_RESPONSE_INVALID` / `JWS_IMZA` · alg none → `JWS_ALG` · başka kurulumun (DR) imzalı yanıtı RED · aynı yanıtın dokunulmamış hâli 200 |
| L24 bakım sonrası belirteç yok | ✅ | bakım bitişi geçmişte HAK sürümü → yoklama BASARILI ama belirteç 0 · fabrika 403 `LICENSE_UPDATES_FROZEN` · kademe NORMAL (`BAKIM_BITTI`, program durmaz) · bakım yenilenince belirteç 200 |
| L25 saat ileri ama yoklama başarılı → kademe düşmez | ⚠️ kısmi | duvar +40 gün: OLCULEMEDI + SAAT_ILERI, güvenilir = monotonik tahmin, kademe UYARI (EK_SURE/KISITLI YOK) · yoklama `ISTEK_ZAMAN` ile reddedildi, sonra da kademe düşmedi. **Neden kısmi:** "yoklama başarılı" kolu bugünkü protokolde gerçekleşemez — Bulgu 2 |
| L26 OLCULEMEDI'de production açık | ✅ | üretimsiz HAK sürümü (açık onay) → GECERLI'de `GET /api/work-orders` 403 `LICENSE_MODULE` (tavan uygulanıyor) · saat ileri (OLCULEMEDI) → 200, panel bloğunda kapalı modül yok · üretim geri → 200 |
| L27 kira zinciri | ✅ | (a) snapshot geri alma → satıcı kararı YAKALA, yeni uyarı yok · (b) yanıt yolda kayboldu → yeniden deneme AYNI kirayı aldı, yoklama sonucu TEKRAR · (c) iki parmak izi: ilk pencerede ikisine de kira + portal uyarısı; ikinci pencerede kopyaya `KIRA_VERILMEDI`, sahip BASARILI; kopya kira bitişinde EK_SURE (anında durdurma yok) |
| L28 kimliksiz istek → rotanın 401'i; kimlik istemeyen kapalı uçta `LICENSE_GATE` (F1b, D6) | ✅ | K5'te kimliksiz ve geçersiz token'lı `POST /api/orders` **401** (lisans kodu/kademe yok) · kimlik istemeyen kapalı uç `POST /api/devices/announce` 403, `details` YALNIZ `{code: LICENSE_GATE}` · kimliksiz `/api/license/durum` `{ayrinti:false}` · `/api/admin/health` 200 (license bloğu) · kimliksiz `GET /api/mobile/updates/*` kapıdan geçti (404, `LICENSE_*` değil) · `login-methods` 200 |
| L29 DR sonrası eski ana bağlanınca DEVREDILDI → KISITLI | ✅ | ana kopukken D devraldı · ana bilmiyor · bağlanınca devredildi kirası → KISITLI + tehlike bandı · `POST /api/orders` 403 {devredildi: true} · `GET` 200 |

## Bulgular

1. **[DÜZELTİLDİ — lisans motoru] Kira alışverişi yarışı (L13).** Tam koşumda L13 kırmızı: DR kurulumu etkinleşince zil bağlanır ve yoklama tetikler; yöneticinin `dr-devral`ı onunla aynı anda gider, yoklamanın daha yeni kirası önce kabul edilir ve devralımın yanıtı `409 LICENSE_LEASE_STALE` döner — devralım satıcıda başarılıyken. Aynı yarış "şimdi yokla" ile zil yoklaması arasında da var (başarısız yoklama kaydı → iki anahtarlı kısıtlamanın ikinci anahtarını sahte doldurabilir). Düzeltme: `license-sync.service.ts` `runLeaseExchange` — yoklama, etkinleştirme, DR, taşıma, aktarma/QR kabulü tek kuyruktan. Bekçi `test_lisans_motoru §9` (negatif sonda M6: kuyruk atlanınca `BASARISIZ LICENSE_LEASE_STALE`; dalda §8/M5 idi, entegrasyonda satıcı tamamlamanın §8/M5'iyle çakıştığı için yeniden numaralandı).
2. **[AÇIK — tasarım] Saat ±10 dk'dan fazla kaymışken yoklama yapılamaz (L25).** İSTEK duvar saatiyle imzalanır; satıcı `zaman`ı ±10 dk dışında `ISTEK_ZAMAN` ile reddeder. Sonuç: saati bozuk makine hiç yenileyemez; kademe güvenilir saatle düşmediği için erken durma yok, ama kira + ek süre (≤ 60 gün) sonunda iki anahtar dolar → KISITLI — internet VARKEN. Aday çözümler (karar yöneticide): (a) satıcı `ISTEK_ZAMAN` gövdesinde sunucu saatini döndürür, fabrika bir kez ofsetle yeniden imzalar (protokol değişikliği + ayna + belge §5); (b) güvenilir saatle imzalama — makine uyuduysa tahmin geride kalır, doğru saatli makinede yeni red doğurur. (a) önerilir.
3. **[NOT] Taşıma onayı saatlik yoklamayı bekler.** Taşıma bekleyen kurulumun kirası yok → zile abone olamaz (fabrika `canConnect` kira ister, satıcı zil kimliği kayıtlı anahtar ister); onay sonrası kurulum ancak bir sonraki yoklamada (kirasız varsayılan 60 dk) ya da yöneticinin "şimdi yokla"sıyla tamamlanır. Senaryo "şimdi yokla" ile ölçtü. İyileştirme adayı: bekleyen taşımada yoklama aralığı kısa.
4. **[NOT] Yönetici kararı (d) bu tabanda yok.** `GET /api/auth/login-methods` yanıtında `lisansDurduruldu` alanı yok (başka dilimin işi); L28 bunu `ℹ️` satırıyla not eder, alan inince kontrol eklenmeli.
5. **[DÜZELTİLDİ — entegrasyon dalı, lisans dışı] `test_script_guards §10b` kırmızıydı.** Kendi hedefini kuran kapısız betik tavanı 1, ölçülen 2: `test_bakim_rolu.ts` (Faz 0.8) kümeye kendi kimliğiyle bağlanıp `DATABASE_URL`i yeniden kurar ama hedef kapısını çağırmıyordu. Entegrasyonda §3 küme katmanı bağlanmadan önce `hedefDbEngeli() ?? fixtureHedefEngeli()` sorar (fixture değilse ❌); `test_script_guards` 44/0.

6. **[DÜZELTİLDİ — entegrasyon, koşucu] Satıcı tamamlamanın iki kuralı koşucuyu kırdı (L1 → L29 zincirleme kırmızı).** (a) Kurulum artık KAYITLI bir kanala doğar (`requireChannel`, kanal ana verisi): L1'in `senaryo-kanal`lı kurulumu `400 GOVDE_GECERSIZ` aldı, sonraki bütün adımlar ondan düştü. Koşucu L1'de kanalı portaldan açar (`GET /kanallar` → yoksa `POST /kanallar` 201); satıcı yardımcısının `temizle`si kurulumsuz kalan senaryo kanalını siler (`--kanallar`). (b) Bayi tavanı kanal listesi, kalıcı izni (varsayılan HAYIR) ve bakım ay tavanı taşır: L20'nin bayi tavanı `kanallar: [senaryo-kanal]` · `kaliciIzni: true` · `bakimAyTavani: 12` ile açılır, bayi HAK'ının bakım bitişi +330 gün (12 ayın açıkça içinde). Ürün kodu değişmedi.
7. **[DÜZELTİLDİ — entegrasyon, Senaryo Y] Y2g aralıklı kırmızı.** Kopya işi "hazır"ı `withDecryptedCopy`nin `finally`sindeki geçici dosya silmesinden ÖNCE yayımlar; Y2g "hazır" anında klasörü okuyunca geçici `.coz-*.part` birkaç ms görülebiliyordu (4 koşumun 1'inde). Y2g artık sınırlı (≤ 2 sn) bekleyip "kalmadı"yı ölçer; ürün davranışı aynı.

## Borçlar

| Borç | Kapanır |
|---|---|
| L15 CF Worker çalışma zamanı | Faz 3a Worker'ı yazıldığında koşucu belirteci Worker'a (Miniflare/wrangler dev ya da canlı test rotası) verip aynı dört sınıfı ölçtüğünde |
| L18 derleme tarihi | Faz 2e imzalı derleme künyesi `buildEnvironment.derlemeTarihi` ve runtime'a girdiğinde; koşucu bakım bitişinden sonra derlenmiş künyeyle açıp UYARI → EK_SURE'yi ölçer |
| L25 saat kayıkken yoklama | Bulgu 2'nin kararı uygulandığında (satıcı saat ipucu + tek yeniden deneme) koşucunun L25 "yoklama başarılı" kolu yeşile döner |
| Senaryo Y6d | `kur.ps1 -GeriAl` PowerShell/TTY kısmı thinkpad-1 provasında (Senaryo Y'nin beyanlı atlaması) |
