# Gece Raporu — 2026-09-03 (02:00 → 09:30)

> Tek yerden okunacak özet. Ayrıntı: kararlar `GECE-KARARLARI-2026-09-03.md` ·
> karar notları `docs/history/CLAUDE-NOT-ARSIVI.md` · doküman turu
> `DOKUMAN-MERCEK-RAPORU-2026-09-03.md`. Dal: `feature/modul-bayrak` (push'lu).

## 1. Ne bitti

| Paket | Durum | Commit |
|---|---|---|
| **Dilim 0** — repo birleşmesi | ✅ | `main` ff-merge; `adnansahin` + `feature/depo-mal-kabul` origin'den silindi; dallanma kuralı CLAUDE.md'de |
| **P1** — modül anahtarları (backend) | ✅ | `c94035cc` · `251767ca` · `06e23448` · `199213e4` |
| **P2** — süperadmin (satıcı hesabı) | ✅ | `bfddd846` · `745bf3eb` · `628f8c12` · `bd71a0b2` |
| **P3** — ayar şifresi | 🟡 **WIP** `9f33d0e3` — uygulandı ve ölçüldü; güvenlik turunun 3 major bulgusu için düzeltme turu KOŞUYOR |
| **P4** — kalite-yetenek Faz A | 📋 spec hazır (`p4-spec.md`), kod başlamadı |
| **P5 / P6** — Electron karo + Sistem Profili / tamlık bekçisi + profiller | 📋 spec hazır; **sıra değişti: P6 önce, P5 sonra** (P5, P6'nın `ScreenEntry.modul` alanına bağımlı) |
| **P7** — doküman mercek turu | ✅ rapor `50bd77e2` (116 madde); uygulama sabah onayından sonra |

**Ölçüm özeti:** P1'de 1036 kontrol yeşil · P2'de `test_superadmin` iki kurulumda (hesaplı 126/0, hesapsız 138/0) + 43/0 tek-kaynak bekçisi · P3'te 102/0. Her pakette fabrika dump'ı provası (230 migration, `test_consistency` aynı 4 bilinen bölüm, `test_db_invariants` 157/0) ve "Adnan Şahin'de sıfır fark" ölçümü (70 mount, hesapsız/hesaplı birebir).

## 2. Kutsal kısıt: sıfır fark

Fabrika damgasıyla **yalnız iki uç** durum değiştirdi, ikisi de tasarım karar #4'te yazılı ve fabrikada erişilmeyen yüzey:
`/api/goods-receipts/*` ve `/api/warehouse-transfers/*` → 403 `MODULE_DISABLED`
(dump ölçümü: 0 mal kabul · 0 depo · 0 transfer · 0 alış siparişi · 0 iplik hareketi).
Diğer 4 uç (item-price · purchase-order · stock-count · yarn) zaten `finance.enabled` ile 403'tü — sebep değişti, statü değişmedi.

## 3. Verilen kararlar (onayınızı bekleyen özet)

Tamamı gerekçeli: `GECE-KARARLARI-2026-09-03.md`. Öne çıkanlar:

- **P1:** DB anahtarları `finance.enabled` kalıbında (`ticaret.enabled` …), middleware `require<Alan>Enabled`; grandfathering değeri **sabit değil "dünkü davranış"** — `ticaret/iplik := finance.enabled` (sabit `false` yazsaydık demo kurulumunda dört yüzey sessizce 403'e düşerdi).
- **P2:** hesap YOKSA modül-yazma kilidi devre dışı + audit (**emniyet supabı** — sert kilit deploy anında fabrikayı kilitlerdi); TOTP `.env`'den tohumlanır, **kurtarma kodu bilinçli yok**; audit satırları takma adla görünür, kimlik uçları **404**; `SUPERADMIN_FORCE_SYNC` rotasyonu.
- **P3:** şifre **başlıkta** (`X-Settings-Password`), hash `set()` dışında; süperadmin ve belge-only gövde muaf; hash yoksa kapı uyur.
- **P4:** boğaz **ikiz** (yüklem + Prisma where-parçası) — 28 karar noktasının 12'si `where` içinde; `assertWoAtStepKind` Faz B'ye bırakıldı.
- **P6:** profiller **TS sabiti** (plandaki `deploy/profiller/*.json` üretim paketine hiç girmiyor — ölçüldü); `TEKSERP_PROFIL` yoksa job hiçbir şey yazmaz.
- **P5:** ayar kategorilerinde modül = **kilit** (salt-okunur + bant), gizleme değil; `finance` kategorisinin mevcut gizleme davranışı korunuyor (bkz. §5).

## 4. Bulunan ve kapatılan gerçek açıklar

Adversarial turların ürettiği, planda olmayan bulgular:

1. **Mobil `usePermission.has()` global `*`'ı tanımıyordu** — süperadmin tablette PIN'le girer, "yetkin yok" ekranında kalırdı. (OTA ile gider, APK gerekmez.)
2. **`/admin/users/:id/credentials` düz PIN'i kontrolsüz veriyordu** ve audit listesi süperadminin id'sini basıyordu → id → PIN zinciri; 18 uçluk önek kapısı + 404.
3. **AUTH audit satırında `recordId` gerçek giriş adını basıyordu** — aktör maskesi aynı satırda çürüyordu.
4. **İplik kg defteri servis katmanında kapısızdı** — ticaret açık + iplik kapalı kurulumda mal kabul/sayım deftere yazıyordu.
5. **P3 kilit kovası girişle aynıydı** — 5 yanlış ayar şifresi aynı IP'den giren herkesin login'ini kilitliyordu (spec'imdeki hata, ölçülerek düzeltildi).
6. **`/admin/backups/offsite` ayar yazıyor ama şifre kapısında değildi** — açık admin oturumu yedek hedefini (tam DB dökümü) değiştirebiliyordu. *(düzeltme turunda)*
7. **Ayar şifresinde Türkçe karakter/boşluk** kabul ediliyordu ama HTTP başlığı taşıyamıyor → fabrika rotasyona kadar kilitlenirdi. *(düzeltme turunda)*

## 5. Sabah onayınızı bekleyenler

| # | Konu | Öneri |
|---|---|---|
| 1 | **Fabrika BUILD klonu** `D:\tekserp-build` hâlâ `adnansahin` dalında — sıradaki paketlemeden önce sunucuda tek seferlik `git checkout main` (reçete `deploy/README.md`). | Siz koşturacaksınız (sunucu erişimi bende yok) |
| 2 | **Sürüm notu taslağı** hazır (panel: "Genel Ayarlar → Modüller'e Ticaret/İplik/Çoklu Depo eklendi; İplik/Alış Siparişi/Fiyat/Sayım ekranlarının kapalı olma sebebi artık Ticaret modülü"). Paketleme YAPILMADI — kapı sizde. | Onayınızla yayın turu |
| 3 | **P7'nin 10 tartışmalı sınıflaması** (TR-only · kalite seed eşlemesi · refakat kartı sınırı · şube · rol şablonu · rapor karneleri · tambur toleransı · yarı mamul · `adnansahin` yayın adresleri · dev DB adı) | Rapordaki §Sabah onayı bölümü |
| 4 | **`finance` kategorisi**: tasarım §3.5 "modül kapalıysa salt-okunur + bant" diyor, bugün kategori tamamen GİZLİ. Değiştirmek görünür fark üretir. | Gizleme korundu; kararınız |
| 5 | **KK1 ekranı `productionEnabled`e bağlanacak** (P6 eşlemesi) — üretim kapalı bir kurulumda ham giriş ekranı kalmaz; karar #2'nin "ayrı sade Mal Girişi ekranı" sözü henüz yazılmadı. | İlk toptancı müşteride yazılır |
| 6 | **Tasarım §3.6 tek resolver** (modül kapalıyken alt bayrak okunmaz) backend'de YOK — üretim kapalıyken KK1/tambur bayrakları hâlâ koşuyor. | Dilim 2'ye alındı |

## 6. Ortam değişiklikleri (dokunduklarım)

- **Dev DB `tekserp_demo` 228 → 230 migration** (P1 grandfathering + P2 kolonu). Damga sonucu: ticaret/iplik/çoklu-depo **açık** (finance açık + 2 depo → "dünkü davranış"), sistem hesabı yok → supap açık. Davranış öncekiyle aynı.
- **`:4000` dev sunucusu yeniden ayağa kaldırıldı** (`nohup`, `.env`'den). Bir ajan `pkill -f "tsx src/server.ts"` ile onu düşürmüştü → kalıcı kural (tasarım §12-12): yalnız kendi PID'ini öldür.
- Test DB `tekserp_modul_test` (fabrika dump'ı + 230 migration; sahte süperadmin `bakim`, test kullanıcısı `p2test/test123`). Prova DB'leri silindi.
- `Teks-Erp/.env` peer tarafından git geçmişinden kurtarıldı (JWT_SECRET dev değeri; DATABASE_URL `tekserp_demo`).

## 7. Sırada

`P3 düzeltme turu (koşuyor)` → **P4** (kalite-yetenek Faz A) → **P6** (tamlık bekçisi + profiller) → **P5** (Electron karo + Sistem Profili) → P7 uygulaması (onaylı maddeler) → Dilim 1 kapanış provası → **Dilim 2** (davranış bayrakları: `shipping.orderRequirement` · `weighRequired` · `invoiceMode` · `gradeRequired` · `batchRequired` + §3.6 tek resolver) → **Dilim 3** (kumaş-teknik + rezervasyon tasarımı) → Dilim 4 yalnız tasarım.

**Model notu:** Fable haftalık hak %75'e dayandığı için gece 09:00'dan itibaren tüm ajanlar Opus (yüksek efor, kritik doğrulamada çift tur). Ana oturumunuzu da `/model opus` yapmanız önerildi.
