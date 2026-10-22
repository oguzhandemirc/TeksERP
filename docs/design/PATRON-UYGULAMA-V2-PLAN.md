# Patron uygulaması v2 — UI/UX sıfırdan + senkron yenileme: dilimli plan

**Durum: TASLAK 2026-10-22, patron oturumu** · Yazan: plan yazarı ajanı (Fable) · Girdiler: `scratchpad/patron/{KARARLAR,R1-uygulama,R2-senkron,R3-tasarim-dili,R4-kurallar}.md` · Ana dal `main` @ `4af7b1520`.

> Kod YAZILMADI. Bu belge dilimlerin sözleşmesidir; her dilimin ajan istemi `scratchpad/patron/istemler/<DİLİM>.md`dedir, oradaki sözleşme buradakinin kopyasıdır (çelişirse BURASI kazanır; BURASI `KARARLAR.md` ile çelişirse KARAR kazanır).

## 0 · Amaç, istek, koşullar

Patron uygulaması bugün "jenerik veri gezgini"dir: fabrikanın zengin özetleri anahtar-değer yığını olarak basılır, ekranlar arası gezinme sekmesizdir, renk/ikon/tipografi dili yoktur ve veri yalnız ekrana girişte çekilir. Kullanıcı isteği üç cümledir: uygulama tamamen yenilensin (bizim indigo+alan-rengi dilimiz, Apple'ın son düzeni, sade ama renkle ayrışan); patron ve çalışan hesapları ilk bakışta ayrılsın; fabrikadaki değişiklik patrona dakikalar değil saniyeler içinde yansısın.

Koşullar: fabrika backend'i müşteri yerinde (on-prem) ya da müşterinin VDS'indedir ve GELEN port açılmaz; patron bulutu bizim VDS'imizdedir ve ORTAKtır (Adnan Şahin'in verisi orada); bulut multi-tenant tek DB değildir, **tesis başına ayrı DB + RLS**; uygulama yalnız bulutun `/api/*`sine konuşur. Deneme fabrikası (test grubu) backend yayını alır; Adnan Şahin'e dokunulmaz.

## 1 · Teşhis özeti (R1/R2)

1. Tazeleme sinyali YOK: yoklama, `AppState` dönüşü, aşağı çek, bayatken-göster yok; zil çalar ama ekran yeni veriyi çekmez (R2 §4).
2. Fabrika → bulut sabit aralıklı (kira 5 dk + 60 sn tık): ortalama 3, en kötü 6 dk; hata sonrası tam aralık bekler.
3. Zil yalnız anlıkları tazeler; listeler zille gelmez; buluttan yazılan sipariş listeye 0–6 dk sonra düşer.
4. "Son eşitleme" damgası oturum boyu donuk (`session.refresh()` hiç çağrılmıyor); kart damgası bulutun çekilme anıdır, fabrikanın değil.
5. Bilgi hiyerarşisi yok (`Title 20 / Body 16 / Muted 14`); tipografi/ikon/radius/gölge token'ı yok; karanlık mod yok.
6. Renk kodu yok: `Badge` 3 renk; geciken/negatif vurgusu yok; enum'lar ham İngilizce (`PARTIAL_SHIPPED`).
7. Liste satırı kaydın TÜM skaler alanlarını basar; müşteri adı sipariş listesinde görünmez (`cariKartId` gizli).
8. Telefonda sekme/menü yok; bölüm değiştirmek Pano'ya dönmeyi gerektirir; yerel başlık ve geçiş yok.
9. Para birimi hiçbir tutarda yok (`formatMoney` kullanılmıyor); izin listesi ham kod.
10. Çalışan hesabı boş Pano görür, yönlendirme yok; patron/çalışan ayrımı görsel değil.

## 2 · Kararlar K1–K6 (bağlayıcı; tam metin `KARARLAR.md`)

| # | Karar (kısa) | Gerekçe |
|---|---|---|
| K1 | Doğruluk katmanı (imzalı paket, filigran, uzlaştırma, gelen kutusu, tesis DB + RLS, fail-closed, N/N−1) AYNEN kalır; değişen TETİKLEME ve HABERDAR ETME: fabrika Prisma `$extends` kirli bayrağı → 3 sn debounce, ≥15 sn aralık, tek uçuş; 5 dk tur emniyet; bayrak `patronBulut.olayGudumlu` varsayılan KAPALI. Bulut: tesis başına monoton `degisimSayaci`, `GET /api/degisim?since=&bekle=25` uzun yoklama; zil TÜM projeksiyonları tazeler. Uygulama: SWR + öne gelme/odak/aşağı çek + uzun yoklama (404 → 60 sn yoklama) + fabrika damgası + `session.refresh()`. Hedef ≤20 sn (açıkken) / ≤6 dk (kapalıyken). Reddedilen: doğrudan fabrika API'si, kalıcı WebSocket, expo-sqlite. | Gecikme tetikleme ve haberdar etmede; doğruluk mekanizması olgun ve bekçili, yeniden yazmak kazanç değil risk. |
| K2 | Bizim palet (indigo `#4F46E5`, alan renkleri, 4'lü durum seti, rol rozeti navy+altın) + Apple düzeni (cam yalnız gezinme/kontrol, içerik OPAK, büyük başlık, concentric köşe, Dynamic Type, ≥44pt, hafif haptics, yaylı 200–300 ms); ışık + karanlık; her kartta 4 px sol şerit. | Renk ayırt etmek içindir; okunurluk cama emanet edilmez (iOS 27 opaklık kaydırıcısı). |
| K3 | Telefon alt sekme 5: Pano · Üretim · Siparişler · Finans · Diğer; tablet/web ≥768 sol ray + iki sütun; expo-router `Tabs` (kararlı), native-tabs KULLANILMAZ; sekme zemini opak + ince çizgi; Pano = üst şerit + 4 KPI + uyarı şeridi + alan kartları; her alan "10 saniye" düzeni; `SnapshotView` yalnız `kayit/[projeksiyon]/[id]`de kalır; enum'lar sözlükten + bekçi; para birimi her tutarda; `musteriAdi` opt-in. | Android 5 sekme sınırı ve çalışırken değişmeyen native-tabs; alan ekranı patronun sorusuna cevap verir. |
| K4 | EKLENİR: `react-native-reanimated ~4.1` + `react-native-worklets`, `expo-haptics` (Android'de yalnız `performAndroidHapticsAsync`, VIBRATE engeli korunur); OPSİYONEL `expo-glass-effect`; EKLENMEZ victory-native, @gorhom/bottom-sheet, expo-symbols, sqlite; ikon Ionicons (`@expo/vector-icons`), grafik `react-native-svg` ile 4 bileşen. | Kullanıcı tam yetki verdi; sabah raporunda listelenir, veto hakkı. |
| K5 | Bayt-eşit aynalar (`wire.ts`, `factory-time*.ts`, `terim.ts`); `NATIVE_PUSH=false`; hesap silme; mağaza/keystore; bildirim rota desenleri; ~65 `testID` (korunur ya da testler aynı commit'te); Adnan Şahin'e dokunulmaz; bulut dağıtımı HAZIRLANIR, canlıya ALINMAZ. | Bekçili sözleşmeler; ortak sunucu. |
| K6 | Dilim = worktree + `feature/patron-v2-<dilim>` + PR + CI yeşil → merge; ana ağaçta commit yok; Opus high (tasarım/ekran/sunucu/fabrika), Fable high (plan), Sonnet (mekanik); sürüm uygulama 1.0.2 vc1 → 1.1.0 vc2; sunucu `patron/sunucu/package.json` 0.1.0 → 0.2.0 + sürüm notu patron-sunucu-0.2.0 (yeni). | Paralel dalgalar, izole ağaçlar, ölçülebilir iniş. |

**K1 ↔ R4 §A14 notu:** R4'teki "önbellek yalnız AĞ hatasında gösterilir" cümlesi K1(a) SWR ile daralır. Korunan öz: önbellek SALT-OKUNUR, 403/404'te ve çıkışta silinir, web'de sessionStorage, çevrimdışıyken yazma kapalı, çevrimdışı bandı zorunlu. Değişen: çevrimiçiyken de önbellek "fabrika verisi HH:MM" etiketiyle ANINDA çizilir, arkadan tazelenir. Kural satırı `docs/kurallar/patron-bulutu.md` Uygulama bölümünde P2 içinde güncellenir, gerekçe arşive (2026-10 arşiv dosyası).

## 3 · Hedef mimari

```
FABRİKA (Teks-Erp, tek process)                 BULUT (patron/sunucu, tesis DB + RLS)            UYGULAMA (Expo)
┌──────────────────────────────┐                ┌──────────────────────────────────────┐        ┌──────────────────────────┐
│ Prisma $extends kirli bayrağı│                │ POST /v1/esitle (JWS, gzip, 9201)    │        │ SWR önbellek (peek→ağ)   │
│  create/update/upsert/delete │                │  → kabul → filigran                  │        │ AppState active / odak / │
│  updateMany/deleteMany/raw   │  olay turu     │  → sync_state.change_counter += 1   │ uzun   │ aşağı çek → yeniden çek  │
│  → 3 sn debounce ≥15 sn gap  │ ─────────────▶ │  → changed_projections = kabul adları│ yoklama│ GET /api/degisim         │
│  → tek uçuş, 5 dk EMNİYET    │                │  → change-feed hub uyandırır         │◀──────▶│  since=n&bekle=25        │
│ bayrak patronBulut.olayGudumlu│               │ GET /api/degisim?since&bekle         │        │  404 → 60 sn yoklama     │
│ (varsayılan KAPALI)          │                │  sayac>since → hemen; değilse ≤25 sn │        │ degisenler → tag'li      │
│ zil ozet → TÜM projeksiyonlar│ ◀─ zil (satıcı │  {sayac, degisenler[], fabrikaDamgasi}│        │  useRemote geçersizleşir │
│ gelen kutusu sonrası tur     │    SSE, aynen) │ POST /tazele (30 sn, aynen)          │        │ "Fabrika verisi HH:MM"   │
└──────────────────────────────┘                └──────────────────────────────────────┘        └──────────────────────────┘
```

- **Sayaç** iş hesabı değildir ("bulut hesap yapmaz" korunur); yalnız kabul edilen pakette artar; `degisenler` hesabın okuyabildiği projeksiyon adlarına süzülür; içerik taşımaz (zil kuralıyla aynı sınıf). Bellek-içi halka (son 64 değişim) `since` eskiyse "tüm okunabilir projeksiyonlar" döner.
- **Uzun yoklama** 25 sn (Cloudflare 100 sn altı); tesis başına bağlantı = açık uygulama sayısı; `rateLimit perMinute` sayımına girer (≤3/dk/istemci). Web aynı ucu `fetch` ile kullanır; SSE yok.
- **Fabrika damgası** = `sync_state.horizon` (paketin ufku = fabrika veri anı); uygulama "Son eşitleme"yi bundan gösterir, bulutun alım anından değil.

**N/N−1 uyum tablosu**

| Çift | Davranış | Nerede doğrulanır |
|---|---|---|
| Yeni uygulama + eski sunucu | `GET /api/degisim` 404 → 60 sn yoklama kipi (görünür ekranlar yeniden çeker); `musteriAdi` yok → "—"; her şey bugünkü gibi | P2 `changes.test.ts` §404 |
| Eski uygulama + yeni sunucu | Yeni uç ve alanlar görmezden gelinir (jenerik `Fields` fazladan "Müşteri adı" satırı basar, zararsız); sayaç kullanılmaz | P3 §eski istemci (yanıt gövdesi değişmez) |
| Yeni fabrika + eski bulut | Olay güdümlü tur bugünkü `/v1/esitle`yi daha sık çağırır; paket şeması aynı; `musteriAdi` kolonu N−1 bulutta kabul mü ret mi → **P5 sondası ölçer**; ret ise dağıtım sırası bulut ÖNCE | P5 §N−1 sondası |
| Eski fabrika + yeni bulut | Sayaç artar, `musteriAdi` yok; uzun yoklama yine çalışır (5 dk turda uyanır) | P3 `test_degisim_sayaci` §1 |

## 4 · Tasarım sistemi özeti (tam metin P1'de PATRON-TASARIM-DILI belgesi (yeni, design dizini))

**Token'lar (açık / koyu):** `bg #F2F4F7 / #0B0D12` · `surface #FFFFFF / #1C1F26` · `surfaceAlt #F8FAFC / #252933` · `separator #E2E8F0 / #2E3440` · `text #0F172A / #F1F5F9` · `textSecondary #475569 / #CBD5E1` · `textMuted #5B6576 / #94A3B8` · `navy #161C2B` · `tint #4F46E5 / #818CF8` · `tintContainer #E0E7FF / #2A2A5C`. Alan (metin · çip · koyu): Üretim `#7C3AED · #EDE9FE · #A78BFA` · Siparişler `#0F766E · #CCFBF1 · #2DD4BF` · Sevkiyat `#C2410C · #FFEDD5 · #FB923C` · Finans `#0369A1 · #E0F2FE · #38BDF8` · Cariler `#BE185D · #FCE7F3 · #F472B6` · Stok `#57534E · #E7E5E4 · #A8A29E` · Fason `#A21CAF · #FAE8FF · #E879F9` · Raporlar `#475569 · #E2E8F0 · #94A3B8` · Gelen kutusu = tint. Durum (dolgu · metin · zemin · ikon): iyi `#15803D · #14532D · #DCFCE7 · checkmark-circle` · uyarı `#B45309 · #78350F · #FEF3C7 · warning` · kritik `#B91C1C · #7F1D1D · #FEE2E2 · alert-circle` · bilgi `#475569 · #1E293B · #F1F5F9 · information-circle`; koyu dolgular `#4ADE80 / #FBBF24 / #F87171 / #94A3B8`. Rol: YÖNETİCİ (`bulut:hesap:yonet`) navy zemin + altın `#FDE68A`; EKİP tintContainer + tint.

**Tipografi (sistem fontu, `allowFontScaling`, başlıkta `maxFontSizeMultiplier 1.4`):** display 40/44·700 · kpi 30/34·700 · largeTitle 34/41·700 · title2 22/28·700 · title3 20/25·600 · headline 17/22·600 · body 17/22 · callout 16/21 · subhead 15/20 · footnote 13/18 · caption 12/16·500; sayılarda `tabular-nums`. Boşluk 4·8·12·16·20·24·32; yarıçap sheet 28 · card 20 · cardInner 12 · control 12 · button 14 · chip full; hareket `mobil/src/theme/motion.ts` kopyası (120/180/260/360, press/gentle/bouncy yayları).

**Bileşenler (öncelik):** 1 KpiCard · 2 HeroSummary · 3 SectionHeader · 4 ListRow · 5 StatusBadge · 6 SegmentedControl · 7 FilterChip · 8 StateViews (Empty/Loading iskelet/Error/OfflineBand/ReadOnlyBand/SyncLateBand) · 9 TabBar (`Tabs`, opak + çizgi) · 10 LargeHeader · 11 FacilitySwitcher (formSheet) · 12 SyncIndicator · 13 Form alanları · 14 BottomSheet (`presentation: "formSheet"`) · 15 Button/ConfirmButton · grafik: Sparkline, BarRow, AgingBar, Donut.

**"10 saniye" düzeni:** Pano — tesis adı + rol rozeti + SyncIndicator; 4 KPI (bugün sevk, açık sipariş, vadesi yaklaşan, üretim kuyruğu) büyük sayı + trend; "Dikkat" şeridi (yedek alınamadı, gecikmiş sipariş, çek vadesi 7 gün); alan kartları. Üretim — dönem segmenti; 3 KPI; istasyon dağılımı çubuğu; iş emri ListRow. Siparişler — özet şeridi (açık · gecikmiş · bu hafta · tamam) = süzgeç çipleri; satır cari + no / açık metre + termin rozeti. Finans — alacak/borç/net hero; yaşlandırma çubuğu; Kasa·Çek·Fatura·Tahsilat segmenti. Cariler — arama + "Rol: Tümü"; satır ad + rol / bakiye. Raporlar — kart ızgarası + durum rozeti. Gelen kutusu — segment Bekleyen·İşlenen·Reddedilen, yaş, 24 sa uyarı. Hesaplar — özet sayaçları + rol/durum rozeti. Profil — navy kahraman kart + tema seçimi.

**Erişilebilirlik:** metin ≥4.5:1, büyük sayı ≥3:1; durum asla yalnız renk; AX boyutlarında KPI tek sütun; dokunma ≥44pt (`TOUCH=48` kalır); `useReducedMotion` → 120 ms solma; her ikon düğmede `accessibilityLabel`; `userInterfaceStyle: "automatic"`, profilde Sistem·Açık·Koyu.

## 5 · Dilimler

Ortak: her dilim `git worktree add ../Teks-Erp-wt/<kod> -b feature/patron-v2-<kod> origin/main`; PR; `gh pr checks --watch`; tüm checks SUCCESS olmadan merge yok; bitiş notu `scratchpad/patron/DEVIR-<kod>.md`. Uygulama dilimleri `cd patron/uygulama && npx tsc --noEmit && npm test`; sunucu `cd patron/sunucu && npm run typecheck && npm run lint && node ../../scripts/agir-is.mjs -- npx tsx scripts/run-all-tests.ts <ad>`; fabrika `cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (kendi `_test` DB'si: `node scripts/test-db.mjs ac tekserp_<kod>_test`).

### P0 · Tasarım sistemi belgesi (P1'in içinde)
PATRON-TASARIM-DILI belgesi (yeni, design dizini): §4'ün tam hâli (R3 §C) + K2/K3 + "ham hex yasak, token'dan oku" kuralı + bileşen API'leri (props). Kabul: belgedeki her hex `src/ui/tokens.ts`te var (W'de bekçi `tokens.test.ts` §2 belge↔kod).

### P1 · Tema + bileşen kiti v2 + gezinme iskeleti (uygulama) — Opus high, ~18 dosya, 1 gün
**Hedef:** token'lı ışık/karanlık tema, yeni kit, 5'li `Tabs` + geniş ekranda sol ray; mevcut ekranlar yeni kitle çalışmaya devam eder (içerik E'lerde).
**Dosyalar:** `patron/uygulama/src/ui/tokens.ts` (YENİ; `theme.ts` bunu yeniden dışa aktarır, sonra kaldırılır) · `src/ui/motion.ts` (mobil kopyası) · `src/ui/icons.ts` · `src/ui/haptics.ts` · `src/ui/theme-context.tsx` (`ThemeProvider`, `useTokens`, tercih `store.ts` anahtarı `patron.tema`) · `src/ui/kit.tsx` (adlar + testID'ler korunur) · `src/ui/Frame.tsx` (`Screen` → LargeHeader + `refreshing/onRefresh` props + `StatusBands`) · YENİ `src/ui/{KpiCard,HeroSummary,SectionHeader,ListRow,StatusBadge,SegmentedControl,FilterChip,StateViews,SyncIndicator}.tsx` · `src/ui/charts/{Sparkline,BarRow,AgingBar,Donut}.tsx` · `src/ui/Glass.tsx` (opsiyonel, izole) · `src/lib/labels/{index,ortak}.ts` (wire enum sözlüğü) · `app/_layout.tsx` (ThemeProvider) · `app/(app)/_layout.tsx` (Stack; ≥768 SideNav rayı) · YENİ `app/(app)/(tabs)/_layout.tsx` + `pano.tsx`, `uretim.tsx`, `finans.tsx`, `diger.tsx`, `siparisler/{index,yeni}.tsx` (mevcut dosyalar `(tabs)/` altına TAŞINIR, URL değişmez) · `package.json` (K4 paketleri + `@expo/vector-icons` beyanı + jest `setupFiles` reanimated mock) · `app.json` (`userInterfaceStyle: "automatic"`) · `__tests__/{tokens,kit,tabs}.test.tsx` · PATRON-TASARIM-DILI belgesi (yeni, design dizini).
**Bekçi:** YENİ `__tests__/tokens.test.ts` — `src/`+`app/` altında `tokens.ts` dışında 6 haneli hex yasak (negatif sonda: kit'e `#123456` yaz → kırmızı); YENİ `tabs.test.tsx` — izinsiz sekme çizilmez, rota yolları (`/pano /uretim /siparisler /finans`) değişmedi; mevcut `ui.test.tsx`, `access.test.ts`, `native-push.test.tsx` yeşil; `expo export --platform web` geçer.
**Kabul:** `tsc` + jest yeşil; telefon simülatöründe 5 sekme, tablet genişliğinde ray; karanlık mod sistemle değişir; `blockedPermissions` VIBRATE duruyor; reanimated jest mock'u ile testler koşuyor.
**Risk:** reanimated 4 + jest; `Tabs` içinde eski ekranların `‹ Geri` davranışı; dosya taşıma `safeRoute`/SW desenlerini bozmaz (yol aynı). **Bağımlılık:** yok. **Çakışma:** `src/ui/*`, `app/_layout*`, `(tabs)`, `package.json` yalnız P1.

### P2 · Veri katmanı v2 (uygulama) — Opus high, ~10 dosya, 1 gün
**Hedef:** SWR önbellek; öne gelme/odak/aşağı çek yeniden çekme; `session.refresh()`; uzun yoklama istemcisi (404 → 60 sn); fabrika damgası.
**Dosyalar:** `src/state/cache.ts` (`peek`) · `src/state/useRemote.ts` (önce önbellek `stale:true`, arkadan ağ; `tags`, `refreshing`, `reload`) · YENİ `src/state/useForeground.ts` (`AppState`) · YENİ `src/state/changes.ts` (tek döngü; yalnız ön planda; `GET /api/degisim`; 404 → 60 sn `"*"` yayını; hata geri çekilmesi 5→60 sn; `invalidate(tags)`) · `src/state/session.tsx` (`refresh()` öne gelince + damga değişince; belirteç sessiz yenileme yalnız sunucu ucu varsa — yoksa dokunma) · `src/state/useOpenRefresh.ts` (`/tazele` sonrası damga değişene dek 3/6/10 sn yeniden çek) · `src/lib/refresh.ts` · `src/api/endpoints.ts` (`degisim` — **P3 merge'ünden SONRA** `git rebase origin/main` ile) · `__tests__/{cache,refresh,session}.test.*` güncellenir, YENİ `changes.test.ts`, `useRemote.test.tsx` · `docs/kurallar/patron-bulutu.md` § Uygulama önbellek satırı + `docs/history/arsiv/2026-10.md` notu.
**Bekçi:** `cache.test.ts` (salt-okunur, 403/404 silme, çıkışta silme KORUNUR + yeni `peek`); `changes.test.ts` (§1 ön planda döngü, arka planda durur; §2 404 → 60 sn; §3 `degisenler` → yalnız etiketli hook'lar tazelenir; §4 oturum düşünce durur); `mirror.test.ts` (uç `API_ROUTES`ta — P3 sonrası).
**Kabul:** jest yeşil; sahte sunucuyla: paket damgası değişince ≤1 sn içinde etiketli hook yeniden çeker; 404 sunucuda uygulama bugünkü gibi çalışır.
**Risk:** SWR'nin "çevrimdışı" bandıyla karışması (bayat ≠ çevrimdışı; iki ayrı etiket); pil (yalnız ön plan, tek döngü). **Bağımlılık:** uzun yoklama adımı P3'e. **Çakışma:** `src/state/*`, `src/lib/refresh.ts`, `src/api/endpoints.ts` yalnız P2; `wire.ts`ye dokunmaz.

### P3 · Bulut sunucu: sayaç + uzun yoklama + zil + tel — Opus high, ~9 dosya, 1 gün
**Dosyalar:** `patron/sunucu/prisma/migrations/20261022120000_degisim_sayaci/migration.sql` (`sync_state.change_counter BIGINT NOT NULL DEFAULT 0`, `changed_projections JSONB NOT NULL DEFAULT '[]'`; yeni tablo YOK → `CLOUD_TABLES`/RLS değişmez) + `schema.prisma` · `src/services/sync.service.ts` (`stampSyncState` içinde `kabul.length>0` ise sayaç +1 ve kabul projeksiyon adları; tx içinde) · YENİ `src/services/change-feed.ts` (tesis başına bekleyenler, halka 64, `notify` tx bitince, `waitFor(tesisId, since, bekleMs)`) · `src/http/api-routes.ts` (`GET /degisim`, auth OTURUM, kimlik OKUMA; `since` ≥0, `bekle` 0–25; `degisenler` hesabın okuyabildiği adlarla süzülür) · `src/wire/api.ts` (`ChangeFeed { sayac; degisenler; fabrikaDamgasi }`) → `cp -p` ile `patron/uygulama/src/api/wire.ts` · (ikinci adım) `src/http/factory-routes.ts` rapor sonucu / gelen kutusu sonucu geldiğinde sanal adlar `rapor`, `gelen-kutusu` ile sayaç +1 · `src/lib/db-grants.ts` (yalnız kolon; değişiklik gerekmiyorsa not) · YENİ `scripts/test_degisim_sayaci.ts` · `patron/sunucu/CLAUDE.md` (uç listesi) · `docs/kurallar/patron-bulutu.md` § Bulut + § Bekçiler · `Teks-Erp/docs/BEKCI-HARITASI.md` § patron-bulutu.
**Bekçi:** `test_degisim_sayaci` §1 kabul → +1 ve adlar; §2 yalnız ret → artmaz; §3 `since=şimdiki` bekler, paket gelince <1 sn döner; `bekle=0` hemen; §4 finans projeksiyonu izinsiz hesapta `degisenler`den düşer; §5 halka dışı `since` → tüm okunabilir adlar; negatif sonda: sayaç artışı silinince §1 kırmızı. Mevcut: `test_patron_kapilari` (rota tablosu, kilit), `test_esitleme_idempotency` (makbuz yanıtı değişmedi), `test_rls_sizinti`, `mirror.test.ts` (uygulamada, ayna).
**Kabul:** sunucu paketi + uygulama jest yeşil; `GET /api/degisim` 25 sn bağlantıda `rateLimit` ve Express zaman aşımı sorunsuz (yerel duman); eski uygulama hiçbir yanıt gövdesinde fark görmez.
**Risk:** bekleyen istekler süreç yeniden başlayınca kopar (istemci yeniden bağlanır, kabul edilir); Traefik/Cloudflare zaman aşımı (25 s < 100 s). **Bağımlılık:** yok. **Çakışma:** iki `wire` dosyası + `api-routes.ts` yalnız P3.

### P4 · Fabrika: olay güdümlü tur + bayrak + zil kapsamı — Opus high, ~12 dosya, 1 gün
**Dosyalar:** YENİ cloud-sync dirty-flag modülü (tek yazar `markDirty(table)`, `createDirtyExtension()`; model→tablo eşlemesi = katalog `root.{table,model}` ∪ anlık `reads` tabloları için beyanlı harita; `$allModels.$allOperations` + `$executeRaw*`) · `src/lib/prisma.ts` (`$extends` uygulanır; tip yayılımı ölçülür — bkz. risk) · `src/jobs/cloud-sync.job.ts` (`requestEventRound`: ilk kirliden ≥3 sn, iki tur arası ≥15 sn, `exclusive` tek uçuş, bekleyen bayrak; yalnız bayrak açık ∧ `cloudEligibility.ok`; 5 dk tur aynen; `runSnapshotRound` → `snapshotsOnly:false` [K1 "zil tüm projeksiyonlar"]) · `src/jobs/cloud-inbox.job.ts` (mesaj işlenince olay turu iste) · bayrak reçetesi (`docs/RECETELER.md` § Yeni feature flag, 19 adım): `system-setting.service.ts` (`SETTING_KEYS.PATRON_BULUT_OLAY_GUDUMLU`, DB adı reçete kalıbına uyar — `patronBulut.olayGudumluEnabled`; `readPatronBulutOlayGudumluEnabled(tx?)` varsayılan false; `FeatureFlags.patronBulutOlayGudumluEnabled`; `getFeatureFlags`/`setFeatureFlags`/zod) · `src/constants/settings-scopes.ts` (uygun mevcut kapsam, yeni izin kodu YOK) · `scripts/lib/hepsi-acik.ts` + `npx tsx scripts/profil-matrisi.ts --acik-yaz` · `Electron/src/pages/GeneralSettings/settings-config.ts` (bool satırı; `PatronCloudPage` gösterimi opsiyonel) · YENİ `scripts/test_bulut_olay_gudumlu.ts` · `docs/kurallar/patron-bulutu.md` § Eşitleme satırı + § Bekçiler · `BEKCI-HARITASI.md` § patron-bulutu.
**Bekçi:** `test_bulut_olay_gudumlu` §1 bayrak kapalı → kirli bayrak birikir, dışarı istek YOK; §2 açık + uygun → `order.update` sonrası 3–4 sn'de tek `/v1/esitle`; §3 10 sn içinde 5 yazma → 1 tur; §4 iki tur arası ≥15 sn; §5 `cloudEligibility` kapalıyken istek yok (fail-closed); §6 itx içindeki yazma da kirletir; §7 harita ↔ katalog iki yönlü tam; negatif sonda: debounce silinince §3 kırmızı. Mevcut: `test_feature_flag_contract`, `test_settings_scopes`, `test_profil_tamligi`, `test_bulut_filigran`, `test_bulut_ham_update`, `test_bulut_silme_damgasi`, `test_bulut_tel_aynasi`, panel `PatronCloudPage.lock.test.tsx`.
**Kabul:** bayrak kapalıyken bütün `test_bulut_*` bayt-eşit davranış; açıkken sahte bulutta değişiklik → paket ≤20 sn. **Durma kuralı:** `$extends` sonrası `npx tsc --noEmit` 10'dan çok dosyada tip hatası üretirse DURUR, cast yapmaz, rapora yazar (alternatif: hook'u `prisma.ts` içinde tek noktada `Proxy` ile sarmak — 1e kararı).
**Risk:** tip yayılımı; sıcak tabloda hook maliyeti (bellek-içi `Set.add`, ölçülür); script yazımları bayrağı atlar → 5 dk emniyet. **Çakışma:** `cloud-sync/` içinde P5'le farklı dosyalar; kural/harita dosyalarında bölüm SONUNA ekle + rebase.

### P5 · Fabrika küçük: `musteriAdi` opt-in — Opus high, ~7 dosya, yarım gün
**Dosyalar:** `Teks-Erp/src/cloud-sync/catalog-facts.ts` (`siparis.musteriAdi` ← `customers.name`, `sevkiyat.musteriAdi`, `siparis-kalemi.urunAdi`/`renkAdi`; `derived()`/`col()` hangisi uygunsa `record-builder.ts`/`derived.ts` ile) · `patron/sunucu/src/catalog/projections.ts` (aynı alanlar) · `patron/sunucu/src/catalog/katalog-ozeti.json` (`npx tsx scripts/test_katalog_ozeti.ts --yaz`, aynı commit) · `Teks-Erp/scripts/test_bulut_projeksiyon_allowlist.ts` beklenen kolon listesi · (gerekirse) `Teks-Erp/src/cloud-sync/projections.ts` reads.
**Bekçi:** `test_bulut_projeksiyon_allowlist` (kişisel/finans sınıfı doğru: ad kökte, cari-kart zaten kökte `ad` veriyor), `test_bulut_tel_aynasi` §5 (iki katalog birebir), `test_katalog_ozeti`, `test_izin_suzmesi`, `mirror.test.ts`; **N−1 sondası:** eski katalogla (git stash'lı bulut) yeni kolonlu paket → kabul mü ret mi ölçülür ve rapora yazılır; ret ise dağıtım sırası "bulut önce" W'ye geçer. Katalog sürümü ARTIRILMAZ (alan ekleme N/N−1); eski satırlarda alan yok → uygulama "—"; dolgu için mevcut TAM tetikleme yolu rapora yazılır.
**Risk:** derived alanın cari ad değişiminde güncellenmemesi (reads'e `customers` eklenir). **Bağımlılık:** yok. **Çakışma:** P4 ile `cloud-sync/` farklı dosyalar; bulut `catalog/` yalnız P5.

### E1 · Pano + Üretim + Stok + Sevkiyat — Opus high, ~8 dosya, 1 gün
`app/(app)/(tabs)/{pano,uretim}.tsx`, `app/(app)/{stok,sevkiyat}.tsx`, `src/ui/SnapshotCard.tsx` (emekli/sarmalayıcı), YENİ `src/ui/pano/*`, `src/lib/labels/uretim.ts`, `__tests__/e1-pano.test.tsx`. §4 düzenleri; `useRemote(tags)` + `Screen onRefresh`; `saglik` anlığı Dikkat şeridine; `DASHBOARD_CARDS` izinleri korunur; çalışan hesabında boş Pano yerine "görebildiğin alanlar". Kabul: 4 KPI + Dikkat + alan kartları; izinsiz kart yok; `ui.test.tsx` yeşil.

### E2 · Siparişler + Cariler — Opus high, ~8 dosya, 1 gün
`(tabs)/siparisler/{index,yeni}.tsx`, YENİ `app/(app)/siparisler/[id].tsx` (kalemler), `app/(app)/cariler/{index,[id],yeni}.tsx`, `src/ui/Picker.tsx` (sheet; testID `cari-sec`, `secici-ara` korunur), `src/lib/labels/siparis.ts`, `__tests__/e2-siparis.test.tsx` + `picker.test.tsx`. `musteriAdi ?? "—"`; süzgeç çipleri sunucu `durum` parametresiyle; tarih için segment "Bugün/+7/+30" + metin (tarih seçici paketi YOK). Kabul: satır cari + no + termin rozeti; detayda kalemler; yazma izni yoksa düğme yok.

### E3 · Finans + Raporlar + jenerik kayıt — Opus high, ~7 dosya, 1 gün
`(tabs)/finans.tsx`, `app/(app)/raporlar/{index,yeni,[id]}.tsx`, `app/(app)/kayit/[projeksiyon]/[id].tsx` + `src/ui/data.tsx` (yalnız stil; `SnapshotView`/`Fields` burada kalır), `src/lib/labels/finans.ts`, `__tests__/e3-finans.test.tsx` + `forms.test.ts`. Para birimi her tutarda (`formatMoney`, döviz ayrı satır); `AgingBar`; rapor durumu rozet; rapor ayrıntısı `useRemote(tags:["rapor"])` ile tazelenir. Kabul: finans hero + segment; raporlar ızgara; aritmetik YOK.

### E4 · Diğer, Gelen kutusu, Bildirimler, Hesaplar, Profil, Giriş/Davet — Opus high, ~12 dosya, 1 gün
`(tabs)/diger.tsx` (İş = Cariler·Sevkiyat·Stok·Raporlar; Eylem = Gelen kutusu rozetli; Hesap = Bildirimler·Hesaplar·Profil), `app/(app)/gelen-kutusu/{index,[mesajId]}.tsx`, `app/(app)/bildirimler.tsx` (`NATIVE_PUSH` metni aynen), `app/(app)/hesaplar/{index,[id],yeni,disa-aktar}.tsx` (izinler Türkçe: `PermissionCatalog` açıklama taşıyorsa ondan, yoksa `src/lib/labels/izin.ts` + bekçi), `app/(app)/profil.tsx` (navy kart, rol rozeti, tema Sistem·Açık·Koyu), `app/(app)/hesap-sil.tsx` (yalnız stil), `app/{giris,davet}.tsx` (marka; TOTP QR + elle anahtar aynen), `src/ui/{FacilitySwitcher,NotificationSettingsForm,NotificationDevices,InviteShown,TotpQr}.tsx` (stil), `src/lib/labels/diger.ts`, ilgili testler + YENİ `labels.test.ts` (wire enum'ları + katalog izinleri sözlükte; eksik → kırmızı). Kabul: ekranda ham izin kodu yok; hesap silme testleri yeşil.

### W · Entegrasyon ve dağıtım hazırlığı — Opus (test/testID) + Sonnet (mekanik), ~2 gün
testID envanteri (65) ↔ testler uzlaştırma, `tokens.test.ts` §2 belge↔kod; `app.json` 1.1.0 / vc2 + `package.json` 1.1.0; 7 maskeli ekran görüntüsü `magaza/gorseller/` (`scripts/test_play_magaza.mjs`); `magaza/surum-notu-vc2.tr-TR.txt`; sürüm notu 2.15.12-taslak (yeni) (backend P4+P5 notu; `backend-2.15.12.md` adı yalnız sürüm commit'inde, kullanıcı terfisiyle), `patron/sunucu/package.json` 0.2.0 + sürüm notu patron-sunucu-0.2.0 (yeni); `docs/ops/PATRON-MAGAZA-ANDROID.md` yeni ölçüm bölümü (11); sunucu imajı `deploy/patron/imaj-derle.sh --platform linux/amd64` + `compose-denetle.mjs` + `duman.sh kur <sha>` → runbook `PATRON-BULUTU-KURULUM.md` yeni bölüm 16 "v2 yükseltme hazırlığı" (CANLIYA ALMA YOK — kullanıcı kararı); deneme fabrikası backend yayını (test grubu) için `docs/kurallar/surum-yayin.md` reçetesi + `deploy/kanallar.json` hazırlık kanalı ile paket; Senaryo P (`senaryo-patron.ts`) tam koşum raporu. Kabul: CI tüm işler yeşil; `build:apk:duman` manifest doğrulaması (izin yalnız INTERNET); Senaryo P 0; runbook kaydı.

**Dalga planı:** Dalga 1 = P1 ∥ P2 ∥ P3 ∥ P4 ∥ P5 (≤3 ajan kuralı varsa sıra: P3+P1+P4, sonra P2+P5; P2'nin uç adımı P3 sonrası). Dalga 2 = E1 ∥ E2 ∥ E3 ∥ E4 (P1+P2 merge sonrası; E'ler `src/ui/kit.tsx`/`tokens.ts`/`src/state/*`'ı DÜZENLEMEZ, eksik token/hook rapora yazılır; yeni bileşen `src/ui/<alan>/`). Dalga 3 = W.

## 6 · Açık riskler ve geri alma

- **Bayraklar:** `patronBulut.olayGudumluEnabled` kapalı = bugünkü davranış; sorun olursa panelden kapatılır, kod geri alınmaz. Uzun yoklama ucu yoksa uygulama 60 sn yoklamaya düşer.
- **N/N−1:** yeni kolonun eski bulutta kabulü P5'te ölçülür; dağıtım sırası ona göre (bulut önce). Fabrika backend'i yalnız deneme fabrikasına; Adnan Şahin kanalına çıkmaz.
- **Prisma `$extends` tip yayılımı:** P4 durma kuralı; alternatif Proxy sarması 1e kararıdır.
- **Mağaza:** vc2 yüklemesi kullanıcı elindedir; 12×14 kapalı test şartı sürüyor. Geri alma: Play'de önceki paket; web'de eski imaj etiketi (`PATRON_IMAJ`); bulut göçü DEFAULT'lu ek kolon olduğundan eski sunucu kodu yeni şemayla çalışır.
- **SWR kuralı:** `cache.test.ts`te "403/404 sil, çıkışta sil, salt-okunur" yüklemleri SİLİNMEZ; yalnız "yalnız ağ hatasında göster" → "bayat etiketli göster".
- **Paralel çakışma:** `patron-bulutu.md` ve `BEKCI-HARITASI.md`ye P3/P4/P5 birlikte dokunur → bölüm SONUNA ekle, merge öncesi rebase.

## 7 · Sabah raporu — kullanıcı vetosu listesi

1. **Eklenen paketler:** `react-native-reanimated ~4.1.1`, `react-native-worklets 0.5.1`, `expo-haptics ~15.0.8`, `@expo/vector-icons` (beyan), opsiyonel `expo-glass-effect ~0.1.10`. Eklenmeyen: victory-native, @gorhom/bottom-sheet, expo-symbols, expo-sqlite, tarih seçici paketi.
2. **Sunucu dağıtımı:** imaj + runbook HAZIR, canlıya alma YOK (ortak sunucu; Adnan Şahin verisi). Göç yalnız iki DEFAULT'lu kolon ekler.
3. **Sekme yapısı:** Pano · Üretim · Siparişler · Finans · Diğer (Stok ve Sevkiyat "Diğer › İş" altında; izinsiz sekme gizli, yerine sıradaki alan gelmez — Diğer kalır).
4. **Kural satırı değişimi:** önbellek "yalnız ağ hatasında" → "bayat etiketiyle anında + arkadan tazele" (K1 gereği).
5. **Bayrak DB adı:** `patronBulut.olayGudumluEnabled` (reçete kalıbı; K1 adı `patronBulut.olayGudumlu`).
6. **Deneme fabrikası backend yayını** P4+P5 ile (test grubu); sürüm `2.15.12` terfisi kullanıcı onayıyla.
7. **Tarih seçici yok** (yeni paket istememek için segment + metin); istenirse ayrı karar.
