# Raporlar v2 — sade temel katalog + kayıtlı/özel raporlar + analiz: dilimli plan

**Durum: PLAN (2026-10-24)** — kod YAZILMADI. Dilim istemleri `scratchpad/rapor/istemler/<KOD>.md`dedir; oradaki sözleşme buranın kopyasıdır (çelişirse BURASI kazanır; burası `scratchpad/rapor/KARARLAR.md` ile çelişirse KARAR kazanır). Girdiler: `RAP-R1-envanter.md` (36 rapor eleştirisi), `RAP-R2-kutuphane.md` (yığın araştırması), KARARLAR. Eski plan `RAPORLAR-FAZ-PLANI.md` ve envanter `RAPORLAR-ENVANTER.md` tarihsel kalır; bu belge onları geçersiz kılmaz, üstüne kurar.

## 0 · İstek, kapsam, kapsam dışı

Kullanıcının isteği (aynen):

> "raporlarımız çok karışık ve çok anlamsız. bizim her bir raporu baştan ele almamız lazım. raporlar kesinlikle çok basit şekilde anlaşılabilir olmalı. bunun yanında custom rapor hazırlayabilir olmalıyız. custom raporlar kayıt edielbilir olmalı. istediğimiz zaman aynı raporun yeni halini alabilmeliyiz. bu raporlar belli kategoriler altına da alınabilir. raporlar konusunda grafikler ve içerik tamamen dışarıya pdf olarak aktarılabilir olmalı. custom raporların oluşturulması ister kodla ister sürükle bırak ve benzeri hazır kütüphaneler varsa kullanarak yoksa kendimiz yazarak yapacağımız arayüzden yönetilebilri olmalı. burada raporlar bazen kolerasyon bulmak için falan da kullanılabilir. örneğin çözgü hatalarıyla vardiya saatleri arasında ilişki var mı gibi bir şey bulmak istiyor diyelim bu çok özel bir rapor. bunu örnek verdim her şey olabilir. bu maddenin özeti raporlarımız sade anlaşılır, hatta günlük dilde yorumlanmış şekilde değiştirilebilir parametrelerle yayınlanısn, yani bir raporun müşterilerle veya renk veya desen gibi gibi bir çok şeyle hemen diğer versiyonlarına bakılabilsin, zamanlara göre kıyaslama tek belge üstüne yapılabilsin. bu bölümü tek başına ele al ve detaylı planlama yap ve uygula."

**Kapsam (bu plan):**
1. **R0 — sadeleştirme:** 36 rapor → 14 temel + 3 muhasebe uzman aracı; ortak şablon; grafik ve anlatı PDF'e girer.
2. **R1 — semantik katman + kayıtlı raporlar:** kategori, paylaşım, ön ayar, "yeni hâlini al", anlık görüntü; varyant ve çok dönemli kıyas; eksik boyutlar; patron uygulamasına sunumlu sonuç.
3. **R2 — oluşturucu:** sürükle-bırak + veri paneli + süzgeç kurucu + kod modu.
4. **R3 — analiz:** korelasyon / ki-kare / oran testi, örneklem uyarısı, "ilişki ≠ neden".

**Kapsam dışı:** yanına BI aracı (Metabase/Superset) · ham SQL modu (R4, ayrı karar) · LLM anlatısı (ileride bayrak, varsayılan kapalı) · e-posta ile rapor · tablette rapor ekranı · eski raporların SİLİNMESİ (geçişten sonra kullanıcı kararı, §8) · Recharts'ın topyekûn sökülmesi (kademeli) · sunucu tarafı PDF (Chromium yok) · persona izin şablonlarının yeniden düzeni (§8'de soru).

## 1 · Teşhis (RAP-R1 özeti)

1. **36 rapor ≈ 15 gerçek iş sorusu.** ~20 rapor aynı soruların parçalarını farklı tanımla tekrar cevaplıyor: üç ayrı "fire" (hurda/üretilen · fason giden−dönen · levent beklenen−gerçek), iki "iptal oranı", üç termin ölçüsü (zamanında % · medyan gün · P90), dört "müşteri ne aldı", üç "tezgah verimi".
2. **Kullanım çok düşük:** 57 günde ölçülebilen 29 ucun 14'ü en az bir kez açıldı; en çok açılan ikisi denetim raporu; sipariş ailesinin 7'sinden 5'i hiç açılmadı.
3. **Ana sayı yok:** 3–5 eşit kart, hangisinin cevap olduğu belli değil; ipuçları formül (`Σ atkı / Σ hedef`), jargon (ABC+RFM, P90, take-up, mikro duruş). Kod "rapor yorumlamaz, sayar" diyor.
4. **Grafik PDF'e girmiyor:** `ReportExportSpec` yalnız `tables[]` taşır; ekranda 12 sayfada Recharts var, kâğıtta yok.
5. **Özel/kayıtlı rapor sıfır.** Yeni soru = ≥7 dosya (servis + route + Zod + katalog + ayna + sayfa + export + bekçi). Kayıtlı görünüm yalnız liste tablolarında (`SavedViewsMenu`).
6. **Varyant ve çok dönem yok:** tek "önceki dönem" kıyası var (10 sayfa); "ay ay 12 sütun" yok; kırılım tek boyutlu (`_breakdown.ts`), pivot yok.
7. **Rapor olmayanlar menüde:** parti/top izleme, karne mühürleme, cari ekstre, levent bitiş tahmini, iki denetim raporu.
8. **Eksik boyutlar:** hafta yardımcısı yok; vardiya yalnız dokuma açıkken doğuyor; hata tipi grubu yok; desen ürün adına gömülü (`WeaveDesign` DOKUMA S2'de, inmedi).
9. **Patron uygulaması sonucu ham JSON'dan basıyor** (`humanize(key)`).
10. **"Çözgü hatası × vardiya" bugün sorulamaz:** Yol A (duruş × vardiya) şemada hazır, veri yok; Yol B (kumaş hatası × vardiya) için hata grubu + vardiya takvimi gerekir; fabrikada hata kaydı 3 satır.

## 2 · Kararlar (bağlayıcı; tam metin `KARARLAR.md`)

| # | Karar | Plandaki karşılığı |
|---|---|---|
| K1 | Yanına BI KURULMAZ; ince TS semantik katman (ölçü/boyut kodda, SQL yalnız izinli kimlik + parametre). `factoryDaySql`, brüt `_shipped.ts`, K18 dışlaması, izin/finans süzmesi katmanın İÇİNDE; karmaşık hesaplar (yürüyen bakiye, OTIF, fason üç kova) mevcut helper'a BAĞLANIR; her ölçüye mevcut raporla SAYI EŞİTLİĞİ bekçisi. | §3.1, R1-SEMCEK/SEMKUP |
| K2 | Paketler: `echarts` 6.1 (tek grafik motoru; Recharts kademeli emekli), `react-grid-layout` 2.3, `react-querybuilder` 8.25, CodeMirror 6 (belge tasarımcısıyla ORTAK), `simple-statistics` 7.12; p-değeri kendi (~80 satır, yeni paket yok). Ham SQL YOK. LLM YOK. | §6 paket satırları |
| K3 | R0 önce: ortak şablon = TEK ana sayı + önceki dönem kıyası + "Ne görüyoruz?" (kural tabanlı Türkçe anlatı, ek uyumu) + ana grafik + tablo; 36 → 14 temel + 3 muhasebe uzman aracı; tanımlar TEKİL (tek fire, tek iptal oranı, tek termin ölçüsü); formül dili kalkar; grafikler PDF'e girer (SVG + baskı CSS; Electron `printToPDF`; web `window.print`). | §3.5–3.6, §4.1, §5 |
| K4 | R1: semantik katman + kayıtlı raporlar (kategori, paylaşım izni, ön ayar, "yeni hâlini al" = tanım saklı veri taze, isteğe bağlı anlık görüntü), varyant "küçük çoklular" + tek tıkla diğer değer, çok dönemli kıyas tek belgede. Eksik boyutlar: desen, genel vardiya = VARDİYA TAKVİMİ (zaman penceresinden, kişi ataması gerekmez), hata tipi grubu (K4P kataloğuyla TEK kaynak), hafta yardımcısı. | §3.1–3.3, R1 dilimleri |
| K5 | R2: sürükle-bırak oluşturucu (react-grid-layout + dnd-kit) + kod modu (JSON + CodeMirror + zod). | §4.5–4.6 |
| K6 | R3: korelasyon/analiz (PG `corr`/`regr_*` + simple-statistics; Pearson/Spearman, ki-kare; örneklem uyarısı; "ilişki ≠ neden"; üretim miktarına normalize oran). Çözgü × vardiya: K4P muayene hata kaydı (tür grubu + zaman) × vardiya takvimi; demo veriyle doğrulanır. | §3.8, §4.7, R3 |
| K7 | Güvenlik/performans: tanınmayan alan reddi, `statement_timeout` + iptal, eşzamanlı rapor sınırı, kırılım tavanı; bulut HESAP YAPMAZ. | §3.4 |

Bu plana özgü ek kararlar (plan yazarı; §8'de vetoya açık): **P1** bayrak `reports.v2Enabled` varsayılan KAPALI; **P2** temel raporlar R0'da yeni kod servisi olarak mevcut servisleri BİLEŞTİRİR (yeni SQL yok), semantik katman R1'de aynı helper'lara bağlanır; **P3** sistem raporları da `ReportDefinition` satırıdır (boot uzlaştırmasıyla), kategori bağı tekil olur; **P4** paylaşım rol değil kullanıcı/herkes (kullanıcı ↔ şablon bağı DB'de kalıcı değil); **P5** iki yeni izin `report:builder`, `report:publish`; görme/çalıştırma için yeni izin yok.

## 3 · Mimari

### 3.1 Semantik katman (`Teks-Erp/src/services/reports/semantik/`)

Katman bir **sözlük + derleyici + çalıştırıcı**dır. Kullanıcı yalnız KİMLİK seçer (ölçü, boyut, işleç); değerler hep parametredir; SQL'i yalnız derleyici üretir. Dosya düzeni: `tipler.ts` · `kupler/<kup>.kup.ts` · `boyutlar/*.ts` · `derleyici.ts` · `izin.ts` · `calistirici.ts` · `onbellek.ts` · `katalog.ts` (istemciye izin süzülmüş ağaç).

```ts
// tipler.ts — örnek (son biçimi R1-SEMCEK yazar)
export type Birim = "metre" | "kg" | "adet" | "yuzde" | "gun" | "saat" | "dakika" | "para";
export type OlcuKimligi = `${string}.${string}`;        // "sevk.brutMetre"
export interface OlcuTanimi {
  kimlik: OlcuKimligi; ad: string; aciklama: string;     // açıklama günlük dilde, formül YOK
  birim: Birim; iyiYon: "artis" | "azalis" | "notr";     // anlatının "iyi/kötü" dili
  izin: PermissionCode; modul?: ModulAnahtari;
  tur: "toplam" | "oran" | "helper";
  sql?: (t: Takma) => Prisma.Sql;                        // tur=toplam: SUM/COUNT ifadesi
  pay?: OlcuKimligi; payda?: OlcuKimligi;                // tur=oran: oran YENİDEN hesaplanır, ortalanmaz
  helper?: {                                             // tur=helper: mevcut servise bağ
    hesapla(g: HelperGirdisi): Promise<HelperSonucu>;    // aralik + suzgec + (destekliyse) boyut
    boyutlar: readonly BoyutKimligi[];                   // desteklenmeyen boyut → 400
  };
  esitlik: { rapor: ReportKey; alan: string } | { muaf: string }; // sayı eşitliği bekçisinin hedefi
}
export interface BoyutTanimi {
  kimlik: BoyutKimligi; ad: string; tur: "zaman" | "kategori";
  sql: (t: Takma) => Prisma.Sql; etiketSql?: (t: Takma) => Prisma.Sql;
  secenekKaynagi: "veriden" | "katalog"; kardinaliteTavani: number;
  izin?: PermissionCode; modul?: ModulAnahtari; kisiAdi?: true;   // kisiAdi → buluta gitmez
}
export interface KupTanimi {
  kimlik: string; ad: string; zamanKolonu: (t: Takma) => string;
  kaynak: (g: KaynakGirdisi) => Prisma.Sql;   // FROM + JOIN + ZORUNLU WHERE (K18, statü, satır kapsamı)
  olculer: readonly OlcuTanimi[]; boyutlar: readonly BoyutKimligi[];
}
```

**Derleyici kuralları:**
- Kimlik sözlükte yoksa **400 `SEMANTIK_ALAN_BILINMIYOR`** (adıyla). Ölçü küpte değilse, boyut ölçünün `helper.boyutlar`ında değilse 400. Sessiz düşürme yok.
- İzin: her ölçü/boyut izin + modül taşır; çalıştıran kullanıcıda yoksa derleme **403 `SEMANTIK_IZIN_YOK`** (alan adıyla). Kayıtlı raporda bu blok düzeyinde "Bu bölüm için yetkiniz yok" olarak çizilir; rapor tümden düşmez. Paylaşım görünürlük verir, veri yetkisi vermez.
- Finans: para ölçüleri `report:finance` + `financeEnabled` taşır. Bugün `report:sales` altında görünen tutarlar (yurtiçi/yurtdışı tutar) hangi izinle görünüyorsa o izni taşır — R1-SEMKUP ölçer; ölçülemezse dar olan (`report:finance`) seçilir (fail-closed).
- **Zaman:** gün/hafta/ay/saat/vardiya boyutları YALNIZ `constants/time.ts` yardımcılarından gelir (`factoryDaySql`, yeni `factoryWeekSql`, `factoryMonthSql`, `factoryLocalTimestampSql`). Vardiya: yeni `services/helpers/vardiya-takvimi.helper.ts` `vardiyaSql(kolon)` — `ShiftDefinition` (`startMinute`, `durationMinutes`, `activeWeekdays`) pencerelerini fabrika yerel saatine göre eşler, gece yarısını aşan vardiyayı önceki güne yazar; dokuma bayrağından BAĞIMSIZ. Dokuma açıkken `ShiftInstance` penceresiyle boğaz-ikizdir (bekçi `test_vardiya_takvimi`). Bilinen sınır: vardiya tanımı değişirse geçmiş bugünkü tanımla yorumlanır; rapor bunu notta söyler (tarihli vardiya tanımı PER modülüne bırakıldı).
- **K18 ve statü:** üretim/kalite küplerinin `kaynak`ı `K18_DEAD_STATUSES`i dışlar, SCRAP'i dışlamaz (Kalite Karnesi kuralı); sevk küpü yalnız `_shipped.ts` boğazından geçer (ikinci brüt tanım YASAK); `notIn: []` yazılmaz.
- **Karmaşık hesaplar helper ölçüdür:** OTIF (terminsiz paydadan çıkar ama sayılır) → `shipment-scorecard.report.service.ts`; fason fire (üç kova, yalnız kapanmış kalem) → `subcontract-scorecard.report.service.ts`; yürüyen bakiye → finans servisleri (süzgeç yalnız dökümü daraltır); levent beklenen/gerçek → `helpers/dokuma-levent-rapor.helper.ts`; tezgah süreleri → `helpers/loom-shift-terms.helper.ts`. Bu ölçüler ancak beyan ettikleri boyutlarla kesilir.
- **Kırılım tavanı:** boyut başına `kardinaliteTavani` (varsayılan 50) + "Diğer" kovası; toplam tavandan ÖNCE tam kümeden; satır listesi `capReportLists`/`REPORT_MAX_ROWS` + `warnings`.
- **Çok dönem:** sorgu `zaman.donemler = {birim:"ay"|"hafta"|"gun", adet}` alırsa dönem anahtarı ek GROUP BY boyutu olur (tek sorgu); kıyas `prev`/`prevYear`/`custom` mevcut `_shared.resolveCompareRange`'den.
- **Sayı eşitliği bekçisi** (`test_semantik_sayi_esitligi`): ortak fikstür kurar; her ölçüyü `esitlik.rapor`un mevcut servisiyle aynı aralık/süzgeçle karşılaştırır (toplam + her desteklenen boyut); `esitlik` ya da gerekçeli `muaf` taşımayan ölçü kırmızı (iki yönlü). Negatif sonda: `sevk.brutMetre`den iade geri-eklemesini çıkar → kırmızı sayısı başlığa.

### 3.2 Rapor tanımı JSON şeması (`semantik/rapor-tanimi.schema.ts`, zod `.strict()`)

Tek şema hem oluşturucunun hem kod modunun hem kayıtlı raporun gövdesidir. İstemci şemayı kopyalamaz: `POST /api/rapor-tanimlari/dogrula` Türkçe hata + JSON yolu döner (tek kaynak sunucu).

```json
{
  "surum": 1,
  "baslik": "Vardiyaya göre çözgü hatası",
  "parametreler": [
    {"ad": "donem", "tur": "tarihAraligi", "varsayilan": "son30gun"},
    {"ad": "kiyas", "tur": "kiyas", "varsayilan": "prev"},
    {"ad": "musteri", "tur": "boyutSecimi", "boyut": "musteri", "coklu": true}
  ],
  "varyant": {"boyut": "urun", "ilkN": 6, "gorunum": "kucukCoklu"},
  "donemKiyasi": {"birim": "ay", "adet": 6},
  "bloklar": [
    {"id": "a1", "tur": "anaSayi", "sorgu": {"kup": "hata", "olculer": ["hata.bin_metrede"], "zaman": {"param": "donem", "kiyas": "$kiyas"}}},
    {"id": "g1", "tur": "grafik", "gorsel": "isiHaritasi",
     "sorgu": {"kup": "hata", "olculer": ["hata.bin_metrede"], "boyutlar": ["vardiya", "saat"],
               "suzgec": {"combinator": "and", "rules": [{"field": "hataGrubu", "operator": "=", "value": "COZGU"}]}}},
    {"id": "n1", "tur": "analiz", "yontem": "kiKare", "x": "vardiya", "y": "hataGrubu", "maruziyet": "uretim.metre"},
    {"id": "t1", "tur": "tablo", "sorgu": {"kup": "hata", "olculer": ["hata.adet", "hata.bin_metrede"], "boyutlar": ["vardiya"]}},
    {"id": "m1", "tur": "anlati", "kurallar": ["anaSayiKiyas", "enBuyukPay", "korelasyon", "orneklemUyarisi"], "enFazla": 5}
  ],
  "duzen": [{"i": "a1", "x": 0, "y": 0, "w": 4, "h": 2}, {"i": "g1", "x": 4, "y": 0, "w": 8, "h": 6}]
}
```

- **Blok türleri (sınırlı):** `anaSayi` · `kpi` (≤3 yan sayı) · `grafik` (`cizgi`, `cubuk`, `yiginCubuk`, `pasta`, `isiHaritasi`, `sacilim`, `kutu`, `kucukCoklu` — 8 tür, ECharts seçeneği istemcide türetilir, tanımda serbest ECharts JSON YOK) · `tablo` (düz ya da `pivot:{satir,sutun}`) · `anlati` · `analiz` (R3) · `metin` (sabit not, düz metin).
- **Parametre türleri:** `tarihAraligi` (takvim günü) · `mutlakPencere` (son N saat; K3 ayrımı) · `kiyas` (`none|prev|prevYear|custom`) · `boyutSecimi` (çoklu; "Tümü" = anahtar yok) · `sayi` (eşik). Bloklar `$ad` ile başvurur; başvurusuz parametre ve tanımsız başvuru 400.
- **Varyant:** tek `boyut` + `ilkN` (≤6) + `gorunum: "kucukCoklu" | "secici"`; değerler ana sorgunun en büyük N'idir; küçük çoklularda ortak eksen.
- **Dönem kıyası:** `donemKiyasi` verilirse tablo sütunları "dönem 1 … dönem N + fark"; ana sayı son dönem + bir öncekiyle kıyas.
- **Doğrulama her kayıtta ve her çalıştırmada** koşar; silinmiş/yeniden adlandırılmış ölçü → tanım "bozuk" rozeti + 400 `RAPOR_TANIMI_BOZUK`, eksik çizim yok. Bekçi `test_rapor_tanimi` sistem tanımlarını ve fikstür tanımlarını derler.

### 3.3 Kayıtlı rapor modeli (R1-SEMA; migration `--create-only`, `DropForeignKey` satırları silinir, idempotent)

| Model / tablo | Sınıf | Alanlar (özet) | Not |
|---|---|---|---|
| `ReportCategory` · `report_categories` | KATALOG | `code VarChar(48)? @unique` (null = kullanıcının), `ad`, `ustId?` (≤2 seviye, servis kuralı), `sira`, `isActive`, künye | Sistem kategorileri boot uzlaştırmasıyla; pasife alma yalnız boş kategoride. |
| `ReportDefinition` · `report_definitions` | KATALOG | `tur` (`SISTEM`/`OZEL`, VarChar), `anahtar VarChar(64)? @unique` (SISTEM için katalog anahtarı), `ad`, `aciklama`, `kategoriId`, `sahipId?`, `gorunurluk` (`OZEL`/`PAYLASIMLI`/`HERKES`), `durum` (`TASLAK`/`YAYINDA`/`ARSIV`), `aktifSurumId?`, `bozukMu Boolean`, `clientToken? @unique`, künye | SISTEM satırı koddan; gövdesi kod servisidir (sürüm yok). Numara YOK (iş belgesi değil; bilinçli). `durum` geçişi atomik claim. |
| `ReportDefinitionVersion` · `report_definition_versions` | DEFTER (append-only, yalnız `createdAt`) | `tanimId`, `surumNo` (`@@unique([tanimId, surumNo])`), `govde Json`, `gerekenIzinler String[]`, `olusturanId`, `not` | DEĞİŞMEZ; düzenleme yeni sürüm. Aktif sürüm değişimi `updateMany WHERE {id, aktifSurumId: beklenen}` → `count===0 → 409 RAPOR_SURUM_CAKISMASI`. |
| `ReportPreset` · `report_presets` | KATALOG | `tanimId`, `ad`, `parametreler Json`, `sahipId`, `paylasimli Boolean`, `varsayilan Boolean` | "Kaya Tekstil — son 3 ay". Kullanıcı başına tek varsayılan (partial unique). |
| `ReportShare` · `report_shares` | PİVOT (replace serbest) | `tanimId`, `userId`, `yetki` (`GOR`/`DUZENLE`), `@@id([tanimId, userId])` | Saf yapılandırma pivotu. |
| `ReportRun` · `report_runs` | TELEMETRİ (budanır, 90 gün) | `tanimId?`, `anahtar?`, `surumId?`, `parametreOzeti`, `kullaniciId`, `baslangic`, `sureMs`, `satir`, `durum` (`TAMAM`/`ZAMAN_ASIMI`/`IPTAL`/`HATA`), `hataKodu?` | Ölçüm + iptal kimliği. Audit muaf (TELEMETRI), `test_telemetri_defter_degil` beyanı. |
| `ReportSnapshot` · `report_snapshots` | TELEMETRİ / ayak izi | `runId`, `tanimId`, `surumId`, `parametreler`, `sonuc Json` (sunum + anlatı), `tur` (`KULLANICI`/`ZAMANLANMIS`), `clientToken? @unique`, `sonGecerlilik?` | Silinince raporlanan sayı değişmez → defter değil. "24.10.2026 14:00 itibarıyla" rozeti. |
| `DefectType.defectGroup` | kolon | `VarChar(16)?` + CHECK yok (küme kodda: `constants/hata-gruplari.ts` `COZGU/ATKI/BOYA/LEKE/MEKANIK/DIGER`) | null = "gruplanmamış". K4P planının `DefectType` değişiklikleriyle aynı modele dokunur (§6 çakışma). |

Audit: Category/Definition/Version/Preset/Share CUD → `AuditService.log()` (tx dışında, best-effort). Kategori ve paylaşım yazımı: `report:publish` ya da tanım sahibi (`DUZENLE` paylaşımı dahil). Favoriler tablo DEĞİL: `UserPreference.preferences.raporlar.favoriler` (kişisel; mevcut kalıp). Desen boyutu şema EKLEMEZ: DOKUMA-MANUEL S2'nin `Item.weaveDesignId`ine bağlanır; o alan yoksa boyut kataloğa çıkmaz (fail-closed), "Ürün (kumaş)" boyutu desen dilinde etiketlenir.

### 3.4 Çalıştırma hattı (`semantik/calistirici.ts`)

- Her blok kendi kısa okuma tx'inde SIRAYLA koşar (`tx.*` + `Promise.all` YASAK): `SET TRANSACTION READ ONLY` + `SET LOCAL statement_timeout = '15s'` (ayar `reports.statementTimeoutSec`, 5–45; DB seviyesi 50 sn'nin altında) + `SET LOCAL lock_timeout = '2s'`.
- **İptal:** tx başında `pg_backend_pid()` `ReportRun`a yazılır; `POST /api/rapor-calistirmalari/:id/iptal` (yalnız kendi koşusu, ya da `report:publish`) `pg_cancel_backend` çağırır; istemci bağlantısı koparsa (`req.on("close")`) aynısı. Sonuç 499 benzeri değil, `ReportRun.durum = IPTAL` + yanıt gönderilmez.
- **Eşzamanlılık:** bellek içi semafor (tek process): kullanıcı başına 2, kurulum başına 4; fazlası **429 `RAPOR_SIRADA`** (panel "sırada, birazdan tekrar dene"). Zaman aşımı (PG 57014) → **503 `RAPOR_ZAMAN_ASIMI`** + "dönemi daraltın" önerisi; PG 40P01/40001 → 409 (çekirdek kural).
- **Önbellek:** anahtar = (tanım sürümü | sistem anahtarı) + parametre özeti + kullanıcının izin kümesi özeti; TTL 120 sn, LRU 200 girdi. "Yenile" (yeni hâlini al) önbelleği atlar. TTL tazeliktir, geçerlilik değildir.
- Ölçüm: `ReportRun` + `EndpointLatencyDaily`; özet tablo bu planda YOK (R4, ölçüme göre).

### 3.5 Anlatı motoru (`Teks-Erp/src/services/reports/anlati/`)

Sunucuda üretilir, yanıtta `anlati: [{kural, onem, metin, kanit}]` olarak döner; ekran, PDF, Excel ve patron uygulaması AYNI metni basar. Saf fonksiyonlar; DB'siz bekçi `test_rapor_anlati`.

**Sunum zarfı** (`services/reports/sunum/sunum.types.ts`; Electron'da bayt-eşit ayna, bekçili): `RaporSunumu = { anahtar, baslik, soru, donem, kiyasDonemi?, anaSayi, yanSayilar[≤3], anlati[], grafik, tablo, tanimlar[], parametreler[], varyant?, donemler?, uyarilar[] }`; `anaSayi = { olcu, ad, deger|null, birim, olculemedi?, kiyas?: {deger, fark, yuzde, yon} }`. "Ölçülemedi" sayıya çökertilmez.

**Kural kataloğu** (önem = mutlak etki × güven; ekranda ilk 3, PDF'te ilk 5):

| Kural | Koşul | Örnek cümle |
|---|---|---|
| `anaSayiKiyas` | kıyas var | "Ekim'de 42.300 m sipariş aldınız; eylüle göre %12 fazla." (±%2 altı → "eylülle aynı düzeyde") |
| `enBuyukPay` | kırılım var | "En büyük pay Kaya Tekstil'de: 9.800 m (toplamın %23'ü)." |
| `yogunlasma` | ilk 3 pay ≥ %60 | "İşin %64'ü üç müşteriden geliyor." |
| `degisimKaynagi` | kıyas + kırılım | "Artışın yarısı lacivert renkten geliyor." |
| `egilim` | ≥6 nokta, R² ≥ 0,5 | "Zamanında teslim üç aydır düşüyor." |
| `aykiri` | IQR dışı ya da \|z\| > 3 | "14 Ekim'de fire olağandışı yüksek: 640 m (normalde 120 m)." |
| `esikAsimi` | parametre eşiği | "Depoda 90 günden eski 6.800 m mal var." |
| `sessizlesen` | müşteri ritminin 2 katı sessiz | "Demir Örme 45 gündür sipariş vermiyor; normalde 20 günde bir veriyordu." |
| `kapsamNotu` | dışlanan küme | "Termini olmayan 12 sipariş orana katılmadı." |
| `veriYok` / `suzgecKesti` / `olculemedi` | `dusenSatir` sözleşmesi | "Seçtiğiniz süzgeçle kayıt kalmadı (süzgeçsiz 340 kayıt var)." |
| `korelasyon` (R3) | r, p, n | "Gece vardiyasında çözgü hatası 1000 m'de 4,1; gündüz 2,3. Bu fark tesadüf olmayacak kadar büyük (güçlü kanıt). İlişki, nedeni göstermez." |
| `orneklemUyarisi` (R3) | n < 30 ya da beklenen hücre < 5 | "Yalnız 9 kayıt var; sonuç güvenilir değil." |

**Formül dili yasak:** Σ, P90, medyan, OEE, ABC/RFM, take-up kelimeleri cümleye ve kart ipucuna girmez; karşılıkları: P90 → "10 siparişten 9'u 21 gün içinde gitti"; medyan → "siparişlerin yarısı 12 günde gitti"; ABC → "işin %80'ini getiren 7 müşteri". Bekçi yasak sözcük listesini sunum metinlerinde tarar.

**Türkçe ek yardımcıları** (`anlati/ek.ts`): `bulunma` (-da/-de/-ta/-te), `ayrilma` (-dan/-den/-tan/-ten), `yonelme` (-a/-e/-ya/-ye), `belirtme`, `ilgi`, `iyelik3` (-ı/-i/-sı/-si), `lik` (-lık/-lik/-luk/-lük). Sayı OKUNUŞA göre ek alır: son okunan sözcük tablosu (bir, iki, üç, dört, beş, altı, yedi, sekiz, dokuz, on, yirmi, otuz, kırk, elli, altmış, yetmiş, seksen, doksan, yüz, bin, milyon, milyar) → `3'te`, `6'da`, `40'ta`, `%12'si`, `%12'lik`, `1.000'de`; ondalıkta son okunan kısım ("12,5" → beş → "12,5'te"). Özel ad son ünlüsüne göre kesmeyle ek alır; ünlüsüz/yabancı/bilinmeyen adda ek gerektirmeyen yedek kalıp seçilir ("En büyük pay — X: 9.800 m"). `toLocaleUpperCase("tr")` yasağı: büyük harf gerektiren kalıp yok. Sayı biçimi `lib/number-format` karşılığı, tarih `factoryDateTr`.

### 3.6 PDF ve dışa aktarım (R0-GRAFIK)

- `ReportExportSpec` genişler: `bloklar[]` = `anaSayi` kartları · `anlati` · `grafik {baslik, svg, veri: ReportTableSpec}` · tablolar · `tanimlar`. Tek spec → Excel · PDF · Yazdır (K4 kuralı korunur): Excel'de grafik, VERİ TABLOSU olarak ayrı sayfaya; anlatı ve tanımlar "Özet" sayfasına; görünen metin PDF'inkidir.
- **Grafik SVG'si:** baskı anında ECharts DOM'suz SSR (`echarts.init(null, null, {renderer:"svg", ssr:true, width, height})` → `setOption({...secenek, animation:false})` → `renderToSVGString()` → `dispose`). Ekranda canvas. Boyut A4 içerik genişliği (~180 mm) sabit; renkler baskı paleti.
- **Baskı CSS'i** (`buildReportHtml`): `@page { size: A4; margin: 14mm 12mm 16mm }`; kart/grafik `break-inside: avoid`; `thead { display: table-header-group }`; `print-color-adjust: exact`; üst blok: rapor adı, soru, parametre cümlesi ("Müşteri: Kaya Tekstil · Renk: tümü"), dönem + kıyas dönemi, basım saati (`factory-time`), kullanıcı; sonda tanımlar ve uyarılar.
- Electron `pdf.ipc.ts` yolu DEĞİŞMEZ (belge `pdf:preview`ine dokunulmaz), `PDF_MAX_ROWS` aynen; web panelde aynı HTML gizli `iframe` + `window.print()`. Rapor PDF'i `document-render/`e girmez.

### 3.7 Patron bulutuna rapor sonucu (R1-BULUT)

Bulut hesap yapmaz: fabrika `REMOTE_REPORTS`e temel raporların v2 anahtarlarını ekler (kişi adı taşıyan `production/uretim-akisi` HARİÇ, `audit/*` hariç); sonuç `RaporSunumu`dur (ana sayı, kıyas, anlatı, grafik verisi, tablo — hepsi fabrikada hesaplı). Bulut `catalog/reports.ts` `REPORT_KEY_PERMISSION` iki yönlü birebir genişler; uygulama `SunumGorunumu` ile basar (mevcut `react-native-svg` grafik bileşenleri; yeni paket yok); eski 8 anahtar N−1 uygulamalar için kalır. Tel tipleri `patron/sunucu/src/wire/api.ts` ↔ uygulama aynası bayt-eşit. Bulut DAĞITIMI bu planda YAPILMAZ (hazırlanır).

### 3.8 Analiz (R3)

- Hesap önce PG'de: `corr`, `regr_slope`, `regr_r2`, `regr_count`; Spearman = `rank() OVER` sonrası `corr`; ki-kare için `GROUP BY` sayıları.
- JS: `simple-statistics` (`sampleCorrelation`, `sampleRankCorrelation`, `linearRegression`, `quantile`), p-değeri kendi `anlati/istatistik/dagilim.ts` (Student-t ve ki-kare CDF; düzenlenmiş eksik beta/gama, ~80 satır; referans değerlerle bekçi).
- **Maruziyet zorunlu:** sayım ölçüsü korelasyona ham girmez; `maruziyet` (üretilen metre, atkı) ile oranlanır ("1000 m'de hata").
- **Uyarılar otomatik:** n < 30 ya da beklenen hücre < 5 → `orneklemUyarisi`; çok boyut taranırsa Benjamini-Hochberg düzeltmesi; her analiz kartında "İlişki, nedeni göstermez" sabit notu; karıştırıcı öneri ("tezgaha göre ayrı bakın" küçük çoklu düğmesi).
- **Kanıt dili:** p < 0,01 "güçlü kanıt", p < 0,05 "kanıt var", aksi "belirgin bir ilişki görünmüyor"; |r| 0,1 zayıf · 0,3 orta · 0,5 güçlü.
- **Çözgü × vardiya veri yolu:** Yol A duruş küpü (`MachineStopEvent.reasonCode` → hata grubu eşlemesi `COZGU_KOPUSU → COZGU`) × vardiya; Yol B hata küpü (`RollError.defectTypeId → defectGroup`, K4P inince `origin = INSPECTION` muayene kayıtları dahil) × vardiya takvimi (`detectedAt` ya da dokunma penceresi: doff varsa `DoffEvent.doffedAt`). Referans fabrikada veri yok → R3-ANALIZ demo fikstürüyle (`scripts/fixture-rapor-demo.ts`, yalnız test DB) doğrulanır.

## 4 · Kullanıcı deneyimi

### 4.1 Ortak rapor şablonu (her temel ve kayıtlı rapor)

```
┌ Rapor Merkezi › Satış ve sevkiyat › Sözümüzü tuttuk mu? ────────────── ☆  [Yenile] [PDF] [Excel] ┐
│ Siparişler terminde gitti mi?                                                                      │
│ [Ekim 2026 ▾] [Kıyas: önceki dönem ▾] [Müşteri: Tümü ▾] [Kumaş: Tümü ▾] [+ süzgeç]   [Kaydet ▾]    │
├──────────────────────────────┬─────────────────────────────────────────────────────────────────────┤
│  ZAMANINDA TESLİM             │  NE GÖRÜYORUZ?                                                      │
│      %78                      │  • Siparişlerin %78'i terminde gitti; eylüle göre 6 puan düşük.     │
│  ▼ 6 puan (eylül %84)         │  • Gecikmelerin yarısı Y kumaşında.                                 │
│  ───────────────────          │  • Termini olmayan 12 sipariş orana katılmadı.                      │
│  Geciken: 23 sipariş          │                                                                     │
│  Ort. gecikme: 4 gün          │                                                                     │
├──────────────────────────────┴─────────────────────────────────────────────────────────────────────┤
│  Görünüm: (●) Tek  ( ) Müşteriye göre  ( ) Kumaşa göre  ( ) Renge göre   Dönemler: [Son 6 ay ▾]     │
│  ▁▃▅▇▆▄  ana grafik (ECharts) — önceki dönem soluk çizgi                                           │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Tablo: Kumaş · Sipariş · Zamanında · Oran · Önceki · Fark          (ilk 50 + "Diğer")             │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Bu rapor ne sayar? (tanımlar, günlük dilde)  ·  Veri: 24.10.2026 14:02 canlı                       │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Kurallar: tek ana sayı; kıyas oklu, rengi `iyiYon`dan; yan sayı ≤3; çip tıklanınca seçici MODAL (combobox yok); "Tümü" seçim yokluğu; tarih girdisi `ReportDateFilter`; "Canlı" ≠ "anlık görüntü" rozeti.

### 4.2 Katalog ekranı (Rapor Merkezi; bayrak açıkken `reports` hub'ının yerini alır)

```
┌ Rapor Merkezi ──────────────────────────────────────── [🔍 rapor ara] [+ Yeni rapor] ┐
│ ★ Favorilerim   Sözümüzü tuttuk mu? · Ne kaybettik? · Kaya — son 3 ay (kayıtlı)     │
│ ▸ Satış ve sevkiyat (5)   ▸ Üretim (3)   ▸ Kalite (2)   ▸ Dokuma (3)   ▸ Para (1)    │
│ ▸ Muhasebe araçları (3)   ▸ Kayıtlı raporlar: Kategorilerim (…) · Benimle paylaşılan │
│ ▸ Eski raporlar (geçiş dönemi) — 36 rapor, her birinde "yeni hâli" bağlantısı       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
Kart: soru cümlesi + tek satır açıklama; kayıtlılarda sahip + "bozuk" rozeti. Arama istemcide (katalog küçük). Kapalı, izinsiz ya da modülü kapalı rapor çizilmez.

### 4.3 Kaydet / kategoriye al / yeni hâlini al

- **[Kaydet ▾]:** "Görünümü ön ayar olarak kaydet" (parametreler; kişisel ya da paylaşımlı) · "Kopyasını özel rapor yap" (sistem raporundan OZEL tanım + oluşturucu) · "Bu hâlini sakla" (anlık görüntü; clientToken'lı).
- **Kategoriye al:** tanım sahibi kendi raporunu var olan kategoriye taşır; kategori yaratma/paylaşımı `report:publish`.
- **Yeni hâlini al:** [Yenile] = aynı tanım + parametre, önbelleği atlayan taze koşu. Anlık görüntü açıkken üstte "24.10.2026 14:00 itibarıyla · [Canlıya geç]".

### 4.4 Varyant ve dönem kıyası

- **Varyant seçici:** "Tek / Müşteriye göre / Kumaşa göre / Renge göre / Desene göre / İstasyona göre / Vardiyaya göre" (rapor beyanındaki boyutlar). Seçilince **küçük çoklular**: en büyük 6 değer, ortak eksenli 2×3 ızgara, her hücrede değer + kıyas oku; hücreye tıklamak o değeri süzgeç yapar ("tek tıkla diğer versiyon"). Seçim URL'de.
- **Dönem kıyası modu:** "Son 6 ay / 12 ay / 8 hafta / Bu yıl vs geçen yıl"; tablo sütunları dönemler + fark; grafik çizgi/yığın; ana sayı son dönem. Kesit raporlarında (Depo, Alacaklar) geçmiş kesit hesaplanamıyorsa "geçmiş için aylık kesit görüntüsü gerekiyor" der (§7 R1-ZAMAN).

### 4.5 Oluşturucu (R2; `reports/builder/:id?`, `report:builder`)

```
┌ Rapor oluşturucu — "Vardiyaya göre çözgü hatası" ─── [Görsel | Kod]  [Önizle] [Kaydet ▾] ┐
│ VERİ                    │ DÜZEN (12 sütunlu ızgara, sürükle/boyutla)        │ ÖZELLİKLER    │
│ 🔍 alan ara             │ ┌ Ana sayı ┐ ┌ Grafik: ısı haritası ─────────┐ │ Blok: Grafik  │
│ ▾ Kalite / hata         │ │ 3,2/1000m│ │ vardiya × saat                │ │ Tür [ısı ▾]   │
│   ▸ Hata adedi (adet)   │ └──────────┘ └───────────────────────────────┘ │ Satır: vardiya│
│   ▸ 1000 m'de hata      │ ┌ Tablo ──────────────────────┐ ┌ Ne görüyoruz?┐ │ Sütun: saat   │
│ ▾ Boyutlar              │ │ vardiya · adet · 1000 m'de │ │ (anlatı)     │ │ Ölçü: [..]    │
│   ▸ Vardiya  ▸ Saat     │ └────────────────────────────┘ └──────────────┘ │ Süzgeç:       │
│   ▸ Hata grubu ▸ Tezgah │ BLOK PALETİ: Ana sayı · Yan sayı · Grafik ·      │ [hata grubu = │
│ (izinsiz alan görünmez) │ Tablo · Anlatı · Analiz · Not                    │  Çözgü] (RQB) │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
Veri paneli `GET /api/rapor-semantik/katalog` (izin + modül süzülmüş) ağaçtır; alan bloğa ya da "kuyuya" (Satır/Sütun/Ölçü/Süzgeç/Varyant, dnd-kit) bırakılır. Süzgeç `react-querybuilder` (Türkçe çeviri, `natural_language` çıktısı parametre cümlesine), JSON ağacı sunucuda yeniden derlenir; istemcinin SQL'i yoktur. Önerilen grafik boyut türünden otomatik (zaman → çizgi, tek kategori → çubuk, iki kategori → ısı, iki ölçü → saçılım). Önizleme gerçek veriyle, satır tavanlı, 600 ms gecikmeli.

### 4.6 Kod modu

CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-json`), aynı tanım JSON'u. Sözdizimi hatası yerel `jsonParseLinter`; şema/semantik hatası 500 ms gecikmeyle `POST /api/rapor-tanimlari/dogrula` → `[{yol:"bloklar[1].sorgu.olculer[0]", mesaj:"'hata.binMetrede' diye bir ölçü yok. Şunu mu demek istediniz: 'hata.bin_metrede'?"}]` → JSON yolu sözdizimi ağacından satır/sütuna eşlenir, altı çizilir. Tamamlama: ölçü/boyut kimlikleri katalogdan. Görsel ↔ kod iki yönlü: kod geçerliyken görsel kipe dönülür; geçersizken dönüş kilitli ("önce hataları düzeltin").

### 4.7 Analiz bloğu (R3)

```
┌ Analiz: Vardiya × çözgü hatası ───────────────────────────────── n = 1.240 ┐
│  Isı haritası (vardiya × saat, 1000 m'de hata)   │  Vardiya   1000 m'de  Pay  │
│  ░░▒▒▓▓██ …                                      │  Sabah      2,1       %28  │
│                                                  │  Akşam      2,4       %31  │
│                                                  │  Gece       4,1       %41  │
│  Sonuç: Gece vardiyasında oran belirgin yüksek (güçlü kanıt, p < 0,01).      │
│  ⚠ İlişki, nedeni göstermez. Tezgah ve iplik partisi de etkili olabilir:     │
│     [Tezgaha göre ayrı bak] [İplik partisine göre ayrı bak]                  │
└──────────────────────────────────────────────────────────────────────────────┘
```
Örneklem küçükse sonuç satırı yerine sarı uyarı ("Yalnız 9 kayıt var; karar vermek için en az 30 gerekir"). Saçılım (iki sayısal ölçü, regresyon çizgisi, r ve n) ayrı görsel.

## 5 · Temel katalog (14 + 3)

Her satır: **anahtar** · persona · soru · ana sayı · kıyas · grafik · varyant boyutları · örnek anlatı · yerine geçtiği raporlar. Anahtarlar `REPORT_CATALOG`a yeni satır olarak girer (kapı, kapanabilirlik, izin aynen); UI kategorisi ayrı alan (`kategoriV2`).

1. **`sales/siparis-talep` — Ne kadar iş aldık, kim ne istiyor?** · Patron, satış · ana sayı: alınan sipariş metresi · kıyas: önceki dönem / geçen yıl · grafik: dönem çizgisi + müşteri payı çubuğu · varyant: müşteri, kumaş (desen), renk, yön · anlatı: "Ekim'de 42.300 m sipariş aldınız; eylüle göre %12 fazla. Artışın yarısı Kaya Tekstil'den." + `sessizlesen` · yerine: Sipariş Karnesi, Talep Analizi, Müşteri Karnesi, Müşteri Sipariş Profili, Yurtiçi/Yurtdışı (sipariş kısmı).
2. **`sales/sevkiyat` — Ne sevk ettik, kime, nereye?** · Patron, sevkiyat, muhasebe · ana sayı: sevk metresi (BRÜT, `_shipped.ts`) · yan: tutar (izinliyse), ihracat payı · kıyas: önceki dönem · grafik: günlük/haftalık çubuk + yön yığını · varyant: müşteri, kumaş, renk, yön · anlatı: "Bu ay 38.100 m sevk edildi, %31'i ihracat; geçen aydan %4 az." · yerine: Sevk & Termin (hacim), Yurtiçi/Yurtdışı (sevk + tutar).
3. **`sales/termin` — Sözümüzü tuttuk mu?** · Patron, sevkiyat, satış · ana sayı: zamanında teslim % (OTIF kuralı; TEK termin ölçüsü) · yan: geciken sipariş, "siparişlerin yarısı N günde gitti", "10'dan 9'u M gün içinde" · kıyas: önceki dönem + son 3 dönem eğilimi · grafik: dönem çizgisi · varyant: müşteri, kumaş, yön · anlatı: §4.1 örneği · yerine: Sevk & Termin (termin), Sipariş→Teslim Süresi, Yurtiçi/Yurtdışı (termin).
4. **`sales/acik-siparisler` — Açık siparişler hazır mı, ne eksik?** · Planlama, sevkiyat · ana sayı: açık sipariş metresinin stoktan karşılanabilen yüzdesi · yan: termini geçmiş açık metre (dönemden bağımsız anlık) · kıyas: yok (kesit; R1-ZAMAN görüntüsüyle) · grafik: zincir aşaması yığın çubuğu (dokuma açıkken dokuma adımları dahil) · varyant: kumaş, renk (müşteri: FIFO gerekçesiyle karşılanma müşteriye bölünmez, ama müşteri SÜZGECİ zincir kısmında var) · anlatı: "Açık 18.400 m siparişin %62'si depodan karşılanabilir; 5 siparişin termini geçti." · yerine: Açık Sipariş Karşılanma, Üretim Zinciri.
5. **`production/uretim-akisi` — Üretim nerede takıldı, ne geçti?** · Üretim müdürü · ana sayı: şu an bekleyen top (en uzun bekleyen istasyon vurgulu) · yan: dönemde geçen metre, ort. bekleme (top ağırlıklı) · kıyas: geçen için önceki dönem · grafik: istasyon çubuğu (bekleyen + geçen) · varyant: istasyon, operatör (kişi adı → buluta gitmez) · anlatı: "Kurşun istasyonunda 46 top ortalama 2,5 gündür bekliyor — en uzun kuyruk." · yerine: Nerede Takıldı (WIP), Operatör İş Hacmi ("performans" adı kalkar; birim top/metre).
6. **`quality/kalite` — Kalite nasıl gidiyor?** · Kalite şefi, patron · ana sayı: 1. kalite oranı (METRE ağırlıklı) · yan: 1000 m'de hata, plan dışı onaylı metre · kıyas: önceki dönem · grafik: kademe yığını dönem çizgisi · varyant: kumaş, renk, fasoncu kovası, levent/lot (dokuma) · anlatı: "Bu hafta 1. kalite %91; geçen haftadan 2 puan düşük. Düşüşün çoğu Z renginde." · yerine: Kalite Karnesi, Plan-Sapma Karnesi, Fire Karnesi'nin hata adedi kısmı.
7. **`quality/kayip` — Ne kaybettik, nerede?** · Kalite şefi, patron · TEK fire tanımı: "Fire = satılabilir olmaktan çıkan kumaş metresi"; üç kaynak: hurdaya ayrılan top · fasona giden ile dönen farkı (yalnız kapanmış partiler) · leventten beklenen ile dokunan farkı (yalnız biten levent). Ana sayı: toplam fire metresi; oran YALNIZ kaynak satırında kendi paydasıyla (farklı paydalar toplanmaz, toplam oran basılmaz) · kıyas: önceki dönem · grafik: kaynak yığın çubuğu · varyant: kaynak, kumaş, fasoncu, tezgah/levent · anlatı: "Bu ay 1.240 m fire var; en büyük kaynak boyahane hurdası (%58)." · yerine: Fire Karnesi, Fason Karnesi (fire), Levent Sonucu (fire). Her kaynak mevcut helper'ından okunur (sayı eşitliği bekçili).
8. **`sales/vazgecilen-is` — Ne geri geldi, neden vazgeçildi?** · Satış, kalite · ana sayı: iade + iptal metresi (iki satır ayrı, toplam üstte) · yan: TEK iptal oranı (kaynağı `order-cancellation` servisi; Sipariş Karnesi'ndeki ikinci tanım kullanılmaz), iade oranı (brüt payda) · kıyas: önceki dönem · grafik: sebep çubuğu · varyant: müşteri, kumaş, sebep · anlatı: "Bu ay 820 m iade geldi, en çok 'renk farkı' sebebiyle; 3 sipariş satırı iptal edildi." · yerine: Sipariş İptal Karnesi, İade Karnesi.
9. **`inventory/depo` — Depoda ne var, ne yatıyor?** · Patron, depo · ana sayı: 90 günden eski (ölü) stok metresi · yan: toplam stok, yaşı bilinmeyen metre (ayrı) · kıyas: geçen ay sonu (yalnız kesit görüntüsü varsa; yoksa "kıyas için ay sonu görüntüsü birikmeli") · grafik: yaş kovası çubuğu · varyant: kumaş, renk, depo · anlatı: "Depoda 90 günden eski 6.800 m mal var; geçen aya göre 900 m arttı." · yerine: Stok & Ölü Stok.
10. **`subcontract/fasoncular` — Fasoncular zamanında ve eksiksiz dönüyor mu?** · Planlama, patron · ana sayı: zamanında dönüş % · yan: fasonda bekleyen metre, ort. dönüş süresi; fire satırı `quality/kayip`e bağlantı (tanım orada) · kıyas: önceki dönem · grafik: fasoncu çubuğu · varyant: fasoncu, kumaş, renk · anlatı: "Fasonların %84'ü zamanında döndü; Ak Boya'da 3 parti gecikti." · yerine: Fason Karnesi.
11. **`dokuma/tezgah-randimani` — Tezgahlar verimli mi?** · Dokuma şefi · ana sayı: randıman % (tek oran; Kullanılabilirlik/Performans "neden düştü" açıklamasında günlük dille) · yan: dokunan metre, kapasitenin kumaşa dönen kısmı · kıyas: önceki dönem · grafik: vardiya/tezgah çubuğu · varyant: vardiya, tezgah, levent/lot · anlatı: "Gece vardiyasında randıman %71, gündüzden 9 puan düşük; farkın çoğu çözgü kopuşu duruşlarından." · yerine: Randıman, Kapasite Kullanımı, Vardiya Karnesi.
12. **`dokuma/duruslar` — Tezgahlar neden duruyor, ne çabuk müdahale ediliyor?** · Dokuma şefi · ana sayı: toplam duruş süresi · yan: en sık sebep, ortalama müdahale süresi · kıyas: önceki dönem · grafik: sebep Pareto çubuğu · varyant: vardiya (bugün yok, eklenir), tezgah, sebep grubu · anlatı: "Duruşların %46'sı çözgü kopuşu; müdahale ortalama 7 dakikada başladı." · yerine: Duruş Pareto, Müdahale ve Çözüm Süresi.
13. **`dokuma/levent-dengesi` — Leventten beklenen kumaş çıktı mı?** · Dokuma şefi, patron · ana sayı: biten leventlerde beklenen/gerçek kumaş oranı · yan: fark metresi (fire olarak `quality/kayip`e akar), ölçülemeyen levent sayısı · kıyas: önceki dönem · grafik: levent başına sapma çubuğu · varyant: çözgü kartı, tezgah · anlatı: "Biten 14 leventte beklenenin %97'si dokundu; 2 levent ölçülemedi." · yerine: Levent Sonucu (bitiş tahmini → dokuma planlama).
14. **`finance/alacaklar` — Kimden ne alacağız, ne zaman gelecek?** · Patron, muhasebe · ana sayı: vadesi geçmiş alacak · yan: önümüzdeki 30 günde vadesi gelen çek · kıyas: geçen ay sonu (kesit görüntüsüyle) · grafik: yaş kovası çubuğu + çek vade takvimi · varyant: cari, para birimi · anlatı: "Vadesi geçmiş alacak 1,2 M TL; yarısı 2 müşteride." · yerine: Cari Yaşlandırma, Çek Vade Takvimi. ("Mutabakat" kartı uzman görünümüne iner.)

**Muhasebe uzman araçları (3, mevcut sayfalar kalır; anlatı + formül dili temizliği):** `finance/cash-book` (Kasa & Banka Defteri), `finance/vat-summary` (KDV Dönem Özeti), `finance/fx-diff` (Kur Farkı).

**Raporlardan çıkanlar (rapor menüsünden kalkar, işlev kendi yerinde):** Parti İzleme + Top İzleme → Operasyon "İz sürme" (ve top/parti kartından bağlantı) · Karne Listesi ve Mühür → Dokuma operasyon · Cari Ekstre → cari kartı · Levent Bitiş Tahmini → dokuma planlama · Denetim Kaydı Özeti + Kullanıcı Aktivitesi → Sistem. Uçları ve izinleri DEĞİŞMEZ; yalnız giriş yüzeyi taşınır.

**Eski adres eşlemesi (katalogda `yerine`):** her eski anahtar tam bir hedefe eşlenir (`birlesti → yeni anahtar` · `uzman` · `tasindi → yeni yol`); bekçi 36/36'yı ölçer. Bayrak açıkken eski sayfa açılırsa üstte bant: "Bu raporun yeni hâli: Sözümüzü tuttuk mu? →"; OTOMATİK yönlendirme yapılmaz (eski raporlar geçişte erişilebilir). Yönlendirme ve eski sayfaların kaldırılması ayrı kullanıcı kararıdır (§8).

## 6 · Dilimler

Ortak: her dilim worktree + `feature/rapor-<kod>` + PR + CI tüm SUCCESS → squash merge; Opus high; istem `scratchpad/rapor/istemler/<KOD>.md`. Büyüklük S ≤1 g · M 1–2 g · L 2–3 g · XL >3 g.

### R0 — ortak çatı + sadeleştirme

**R0-ANLATI · L** — Sunum zarfı + anlatı motoru + Türkçe ek motoru. Dosyalar (YENİ): Teks-Erp:src/services/reports/sunum/sunum.types.ts, `sunum/sunum-kur.ts` (yardımcı: ana sayı + kıyas yön hesabı), `services/reports/anlati/{ek.ts, sayi-okunus.ts, gozlem.ts, kurallar.ts, anlati.ts, yasak-sozcuk.ts}`. Bekçi YENİ `test_rapor_anlati` (DB'siz: 60+ ek vakası, sayı okunuşu, her kural bir altın cümle, yasak sözcük, ±%2 eşik, `olculemedi` sayıya çökmez). Sonda: `bulunma` sert ünsüz kuralını boz → ❌ sayısı. Bağ: yok. Kabul: kural kataloğu §3.5 tam, `npx tsc` temiz.

**R0-GRAFIK · L** — ECharts + dışa aktarım. Paket: `echarts@6.1.x` TAM SABİT (Electron; `await import` ile tembel, KU-17) + KUTUPHANELER §9 kaydı + `KUTUPHANELER-TABLO.md` §2 satırı ("grafik: echarts; recharts emekliye ayrılıyor"). Dosyalar: YENİ `Electron/src/pages/Reports/_v2/grafik/{RaporGrafik.tsx, secenek.ts, svgUret.ts, tema.ts}`; DEĞİŞEN `Electron/src/pages/Reports/_components/reportExport.ts` (`bloklar`), `ReportExportBar.tsx` (web `window.print` yolu). Bekçiler: `reportExport.test.ts` genişler (grafik bloğu → PDF HTML'de `<svg`, Excel'de veri sayfası; metin eşitliği), YENİ `raporGrafik.test.ts`, YENİ `recharts-cirit.test.ts` (Recharts import sayısı cırcırı: artış sert, düşüş tabanı düşürür; iki sonda). Kabul: örnek spec'ten PDF (Electron) ve web baskısında grafik vektör; ekran görüntüsü. Bağ: yok.

**R0-TANIM · M** — Katalog v2 + tek tanım sözlüğü + bayrak. Dosyalar: `Teks-Erp/src/constants/report-catalog.ts` + `Electron/src/lib/report-catalog.ts` ayna (yeni alanlar `nesil: "v1"|"v2"`, `kategoriV2`, `yerine`, `persona`, `varyantBoyutlari`; 14 yeni satır; 3 uzman `sinif:"uzman"`), YENİ Teks-Erp:src/services/reports/semantik/tanimlar.ts (ölçü kimliği → Türkçe ad, günlük dil açıklaması, birim, iyiYon, kaynak servis; tek "fire", tek "iptal oranı", tek termin), bayrak `reports.v2Enabled` (RECETELER § Yeni feature flag 19 adım; varsayılan `false`; panel "Raporlar" bölümünde satır). Bekçiler: `test_rapor_katalogu` (yeni §: 36/36 `yerine` eşlemesi), `test_feature_flag_contract`, `test_screen_catalog`, hub kapı testi. Sonda: bir eski anahtarın `yerine`sini sil → kırmızı. Bağ: yok. Risk: hub/karo bekçileri her katalog satırına karo bekler → `nesil:"v2"` ayrımı ölçülerek beyan.

**R0-SABLON · XL** — Panel ortak şablon + Rapor Merkezi. Dosyalar YENİ `Electron/src/pages/Reports/_v2/{sunum.ts (backend aynası), RaporV2Sayfasi.tsx, AnaSayiKarti.tsx, NeGoruyoruzKutusu.tsx, ParametreCipleri.tsx, RaporTablosu.tsx, RaporMerkeziPage.tsx, useRaporV2.ts, favoriler.ts}`; DEĞİŞEN `Electron/src/routes/content-routes.tsx` (14 yaprak route, mevcut domain izinleriyle), `Electron/src/pages/Reports/ReportsHubPage.tsx` (bayrak açıkken Merkez; kapalıyken bugünkü hub bayt-eşit davranış), `tile-config.ts`. Bekçiler: YENİ `test_rapor_sunum_aynasi` (backend ↔ Electron tip dosyası bayt-eşit), vitest (bayrak kapalı → eski hub; açık → merkez; izinsiz/kapalı rapor çizilmez; "Tümü" anahtar göndermez), `command-entries.test.ts`. Ekran görüntüsü (merkez, bir yaprak, boş/hata durumu). Bağ: ANLATI, GRAFIK, TANIM. Boyut sınırı (`*Page.tsx` ≤200) korunur.

**R0-RAPA · L** — Satış temel raporları (1, 2, 3, 4, 8; `report:sales`). Dosyalar YENİ `Teks-Erp/src/services/reports/temel/{siparis-talep, sevkiyat, termin, acik-siparisler, vazgecilen-is}.temel.ts`, Teks-Erp:src/routes/reports/temel-satis.routes.ts (strict Zod, `requireReportOpen`, `report:sales`), `reports.routes.ts` mount satırı. Mevcut servisleri BİLEŞTİRİR, yeni SQL yok; iptal oranının iki tanımını ölçüp farkı PR'a yazar. Bekçiler: YENİ `test_temel_rapor_esitlik` (ana/yan sayı = eski uç alanı, aynı parametre) + rapor kapı/strict/tavan bekçileri + dört kaynak raporun mevcut bekçileri. Sonda: termin ana sayısında terminsizleri paydaya kat → kırmızı. Bağ: ANLATI, TANIM.

**R0-RAPB · L** — Üretim/kalite/depo/fason (5, 6, 7, 9, 10). Dosyalar YENİ `services/reports/temel/{uretim-akisi, kalite, kayip, depo, fasoncular}.temel.ts`, `routes/reports/temel-uretim.routes.ts`. Kayıp: üç kaynak mevcut helper'lardan, oran kaynak satırında. Bekçiler: `test_temel_rapor_esitlik` (kendi bölümü) + kaynak raporların mevcut bekçileri. Sonda: kayıpta fason açık kalemleri kat → kırmızı. Bağ: ANLATI, TANIM.

**R0-RAPC · L** — Dokuma + alacaklar + uzman araç temizliği (11–14 + 3). Dosyalar YENİ `services/reports/temel/{tezgah-randimani, duruslar, levent-dengesi, alacaklar}.temel.ts`, `routes/reports/temel-dokuma-finans.routes.ts` (dokuma uçları `requireDokumaEnabled`, levent ayrıca `requireDevereEnabled`, alacaklar `financeEnabled` kapısı); DEĞİŞEN uzman araç sayfaları (`Electron/src/pages/Reports/Finance/{CashBook,VatSummary,FxDiff}*`) yalnız metin: formül dili → günlük dil açıklaması + "Ne görüyoruz?" kutusu (sunum yardımcısı). Duruşlara vardiya süzgeci (ShiftInstance; R1 takvimi gelince genel). Bekçiler: `test_temel_rapor_esitlik` (bölüm) + dokuma/finans rapor bekçileri. Bağ: ANLATI, TANIM.

**R0-GECIS · M** — Geçiş yüzeyi. "Eski raporlar" bölümü (bayrak açıkken), eski sayfalarda "yeni hâli" bandı (`yerine`den; kendi kendine çizen tek bileşen `ReportPageLayout`ta), rapor dışı araçların giriş yüzeyinin taşınması (Operasyon "İz sürme" karosu, Dokuma operasyon karne karosu, cari kartından ekstre, Sistem'e denetim karoları — uç/izin aynı), komut paleti. Dosyalar: `Electron/src/pages/Reports/_components/ReportPageLayout.tsx`, ilgili `tile-config.ts`'ler, `command-entries.ts`. Bekçiler: ekran kataloğu, palet, hub testleri + YENİ `eskiRaporBandi.test.tsx`. Bağ: SABLON.

### R1 — semantik katman + kayıtlı raporlar

**R1-SEMA · M** — §3.3 tabloları + `DefectType.defectGroup`. Dosyalar: `Teks-Erp/prisma/schema.prisma`, migration `<ts>_rapor_v2_cekirdek`, `scripts/test_db_invariants.ts` (partial unique: kullanıcı başına tek varsayılan ön ayar), `scripts/lib/audit-muafiyeti.ts` (Run/Snapshot TELEMETRI), `scripts/test_telemetri_defter_degil.ts` (budayıcı beyanı R1-ZAMAN'da yazılacaksa ölç, karar PR'a), `scripts/test_timestamptz_contract.ts`. Bekçiler: şema dörtlüsü (drift, invariants, timestamptz, migration hygiene). Bağ: yok.

**R1-SEMCEK · XL** — Semantik çekirdek. Dosyalar YENİ `services/reports/semantik/{tipler, derleyici, izin, calistirici, onbellek, semafor, katalog}.ts`, `services/helpers/vardiya-takvimi.helper.ts`, `routes/reports/semantik.routes.ts` (`GET /api/rapor-semantik/katalog`, `POST /api/rapor-semantik/sorgu` önizleme, `POST /api/rapor-calistirmalari/:id/iptal`); DEĞİŞEN `src/constants/time.ts` (`factoryWeekSql`, ISO hafta, pazartesi), ayar `reports.statementTimeoutSec` (reçeteyle). İlk küp: `sevk` (yalnız `_shipped.ts`). Bekçiler YENİ `test_semantik_derleyici` (bilinmeyen kimlik 400, izinsiz 403, enjeksiyon dizeleri parametrede kalır, `contains` kaçışı, boş liste `notIn: []` üretmez, kardinalite tavanı + "Diğer", tam küme toplamı tavandan önce), `test_rapor_calistirma_siniri` (semafor 429, timeout 503, iptal → `pg_cancel_backend`), `test_vardiya_takvimi` (gece yarısı aşan vardiya, haftagünü, ShiftInstance boğaz-ikizi); `test_report_day_boundary` tarayıcısı `semantik/**`yi kapsar (ölç). Sonda: derleyicide izin denetimini kaldır → kırmızı; `factoryWeekSql` yerine çıplak `DATE_TRUNC('week')` → day-boundary kırmızı. Bağ: SEMA.

**R1-BOYUT · S** — Hata grubu ve desen bağı. Dosyalar YENİ Teks-Erp:src/constants/hata-gruplari.ts (kod + Türkçe ad; duruş sebebi eşlemesi `COZGU_KOPUSU→COZGU`, `ATKI_KOPUSU→ATKI`), DEĞİŞEN `Electron/src/pages/DefectTypes/*` form (grup seçici, modal), backend DefectType yazma şeması (alan iki uçta; `BaseController` yazılabilir alan beyanı). Desen: `Item.weaveDesignId` varsa boyut kaydı, yoksa beyanlı "kapalı". Bekçiler `test_yazilabilir_alan_beyani`, YENİ `test_hata_gruplari` (eşleme kapsamı iki yönlü). Bağ: SEMA.

**R1-BULUT · L** — Patron uygulamasına sunumlu sonuç. Dosyalar: `Teks-Erp/src/cloud-sync/report-requests.ts` (`REMOTE_REPORTS` + v2 anahtarlar, `personalData` beyanı), `patron/sunucu/src/catalog/reports.ts`, `patron/sunucu/src/wire/api.ts` + uygulama aynası, `patron/uygulama/src/ui/raporlar/{SunumGorunumu.tsx, parts.tsx}`, `app/(app)/raporlar/[id].tsx`; RECETELER § Bulut kataloğu değişince. Bekçiler: `test_rapor_istegi`, `test_bulut_ozet_mutabakat`, patron ayna/erişim testleri, YENİ `sunum.test.tsx`. Bulut dağıtımı YOK. Bağ: RAPA, RAPB.

**R1-SEMKUP · XL** — Küpler + sayı eşitliği. Dosyalar YENİ `semantik/kupler/{uretim, siparis, hata, durus, dokuma-vardiya, stok, fason, finans}.kup.ts` (finans yalnız helper ölçü), YENİ `scripts/fixture-semantik.ts`, `scripts/test_semantik_sayi_esitligi.ts`. Her ölçü `esitlik` ya da gerekçeli `muaf`. Sonda §3.1. Bağ: SEMCEK, BOYUT.

**R1-KAYIT · XL** — Kayıtlı rapor arka ucu. Dosyalar YENİ `semantik/rapor-tanimi.schema.ts`, `services/rapor-tanimi.service.ts`, `services/rapor-kategori.service.ts`, `services/rapor-on-ayar.service.ts`, `services/rapor-snapshot.service.ts`, `routes/rapor-tanimi.routes.ts` (CRUD, `dogrula`, `calistir`, `surumler`, `paylasim` replace, `on-ayarlar`, `kategoriler`, `anlik-goruntu`), `jobs/report-definition-catalog.job.ts` (SISTEM satırları + sistem kategorileri boot uzlaştırması); izinler `report:builder`, `report:publish` (`permission-catalog.ts`, `role-template-catalog.ts`, `SCREEN_CATALOG`; RECETELER § route + izin 17 adım; migration YOK). clientToken + `token-replay.helper.ts`; atomik durum/sürüm geçişleri. Bekçiler YENİ `test_rapor_tanimi` (sürüm değişmez, 409 çakışma, paylaşım veri yetkisi vermez → blok "yetkisiz", bozuk tanım 400, sistem tanımları derlenir, audit satırları, replay dört durum) + route/izin reçetesinin bekçileri. Bağ: SEMA, SEMCEK.

**R1-VARYANT · XL** — Kayıtlı rapor sayfası + varyant + çok dönem. Backend: temel uçlara `varyant=<boyut>` (en büyük N≤6 değer için sıralı alt koşu) ve `donemler=ay:6` (≤12 dönem sıralı) parametreleri, strict şemada. Panel YENİ `Electron/src/pages/Reports/_v2/{VaryantSecici.tsx, KucukCoklular.tsx, DonemKiyasTablosu.tsx, KaydetMenusu.tsx, KayitliRaporPage.tsx, AnlikGoruntuRozeti.tsx}`; route `reports/kayitli/:id` (paletsiz; `command-entries` kuralı ölçülür). Bekçiler: `test_temel_rapor_esitlik` (varyant hücresi toplamı ≤ ana sayı; tek değer varyantı = süzgeçli ana sayı), vitest (URL durumu, hücre tıkı süzgece döner, kesit raporunda dönem modu "görüntü gerekir" der). Ekran görüntüsü. Bağ: KAYIT, SABLON.

**R1-ZAMAN · M (koşullu)** — Zamanlanmış koşu + budama + kesit kıyası ölçümü. Önce ÖLÇ: Depo/Alacaklar geçmiş kesiti defterden hesaplanabiliyor mu? Hesaplanamıyorsa ay sonu kesit görüntüsü DEFTER sınıfı yeni tablo olur (silinince kıyas değişir) → kullanıcı kararı (§8), bu dilimde açılmaz. Bildirim bağı N1-MOTOR indiyse onun `emit` helper'ıyla. Budama `maintenance.job.ts` (Run 90 gün; KULLANICI görüntüsü sahibi silene kadar). Bağ: KAYIT.

### R2 — oluşturucu

**R2-DUZEN · XL** — Oluşturucu iskeleti. Paketler: `react-grid-layout@2.3.x` + `react-querybuilder@8.25.x` TAM SABİT (ikisi bu dilimde; lock tek dilimde değişsin) + KUTUPHANELER kayıtları. Dosyalar YENİ `Electron/src/pages/Reports/Builder/{OlusturucuPage.tsx, BlokPaleti.tsx, DuzenIzgarasi.tsx, OzellikPaneli.tsx, Onizleme.tsx, taslakStore.ts, bloklar/*.tsx}`; route `reports/builder/:id?` (`report:builder`; palet `report:builder` = domain kuralına uyar). Bekçiler vitest (blok ekle/sil/taşı → taslak JSON; kaydet = yeni sürüm; görünürlük seçimi `report:publish` yoksa HERKES kapalı). Ekran görüntüsü. Bağ: KAYIT.

**R2-VERI · L** — Veri paneli + kuyular + süzgeç kurucu. Dosyalar YENİ `Builder/veri/{VeriAgaci.tsx, Kuyular.tsx, SuzgecKurucu.tsx (react-querybuilder Türkçe çeviri), onerilenGrafik.ts}`. Bekçiler vitest (izinsiz alan ağaçta yok; RQB çıktısı sunucu şemasından geçer; önerilen grafik tablosu). Bağ: DUZEN.

**R2-KOD · L** — Kod modu. Paket: `@codemirror/lang-json` TAM SABİT; `@uiw/react-codemirror` belge T4 indiyse onun sürümü, inmediyse bu dilim TAM SABİT ekler ve kayda "ortak: belge tasarımcısı" yazar. Dosyalar YENİ `Builder/kod/{KodSekmesi.tsx, yolKonum.ts (JSON yolu → satır/sütun), tamamlama.ts}`. Bekçiler vitest (yol eşleme, iki yönlü geçiş kilidi, Türkçe hata), backend `test_rapor_tanimi` § dogrula mesajları. Bağ: DUZEN.

### R3 — analiz

**R3-ISTAT · L** — Paket `simple-statistics@7.12.x` (backend; gerçek `require()` sınavı, KU-18) + kayıt. Dosyalar YENİ `services/reports/anlati/istatistik/{korelasyon, kikare, oran-testi, dagilim, bh}.ts`, `semantik/analiz.ts` (analiz bloğu: PG `corr/regr_*` + JS), anlatı kuralları `korelasyon`/`orneklemUyarisi`. Bekçi YENİ `test_rapor_istatistik` (referans değerler: bilinen veri setlerinde r, ρ, χ², p dört hane; n<30 uyarısı; maruziyetsiz sayım reddi). Sonda: t-CDF serbestlik derecesini bir kaydır → kırmızı. Bağ: SEMKUP.

**R3-ANALIZ · L** — Analiz UI + demo. Dosyalar YENİ `Electron/src/pages/Reports/_v2/analiz/{AnalizKarti.tsx, Sacilim.tsx, IsiHaritasi.tsx}`, oluşturucu paletine "Analiz" bloğu, YENİ Teks-Erp:scripts/fixture-rapor-demo.ts (yalnız `*_test` DB; hedef DB kapısı) + sistem şablonu "Vardiyaya göre çözgü hatası" (kopyalanabilir OZEL tanım örneği). Bekçiler vitest + `test_rapor_istatistik` uçtan uca (demo veride gece farkı "güçlü kanıt"; 9 kayıtla "güvenilir değil"). Ekran görüntüsü. Bağ: ISTAT, VERI.

### Dalga planı (≤3 paralel)

| Dalga | Dilimler | Not |
|---|---|---|
| D1 | R0-ANLATI ∥ R0-GRAFIK ∥ R0-TANIM | Bağımsız; Electron lock yalnız GRAFIK |
| D2 | R0-SABLON ∥ R0-RAPA ∥ R0-RAPB | `test_temel_rapor_esitlik` iki dilimde: ilk inen açar, ikinci merge'de bölüm ekler |
| D3 | R0-RAPC ∥ R0-GECIS ∥ R1-SEMA | Şema dilimi K4P/DOKUMA S2/bildirim/belge şemalarıyla merge |
| D4 | R1-SEMCEK ∥ R1-BOYUT ∥ R1-BULUT | |
| D5 | R1-SEMKUP ∥ R1-KAYIT | |
| D6 | R1-VARYANT ∥ R2-DUZEN ∥ R1-ZAMAN (koşullu) | Electron lock yalnız DUZEN |
| D7 | R2-VERI ∥ R2-KOD ∥ R3-ISTAT | Electron lock KOD, backend lock ISTAT |
| D8 | R3-ANALIZ | Sonda kullanıcı uçtan uca deneme |

**Çakışma bölgeleri (diğer planlarla):**
- `Electron/package.json` + lock: R0-GRAFIK, R2-DUZEN, R2-KOD ↔ belge T2/T4. Kural: çakışmada origin/main lock'u alınır, `npm install <paket>@<tam>` yeniden koşulur. CodeMirror ORTAK (§R2-KOD).
- `Teks-Erp/package.json`: R3-ISTAT ↔ belge T1A.
- `schema.prisma`: R1-SEMA ↔ K4P (`DefectType` aynı model: `fixedPoints`, `sortOrder`), DOKUMA S2 (`Item.weaveDesignId`), bildirim N1-SEMA, belge T1A. Migration'lar ayrı dizin; model bloğunda iki tarafın satırları korunur.
- `system-setting.service.ts` / `feature-flag.routes.ts` / `settings-config.ts`: R0-TANIM, R1-SEMCEK ↔ bildirim N1-BAYRAK.
- `permission-catalog.ts`, `role-template-catalog.ts`, `SCREEN_CATALOG`: R1-KAYIT ↔ bildirim/belge/K4P izin satırları.
- `maintenance.job.ts`, `test_telemetri_defter_degil.ts`: R1-ZAMAN ↔ bildirim N1-MOTOR.
- Rapor yüklemleri: bildirim N1-KOSUL-IS rapor koşullarını boğaz-ikiz helper'a taşıyor; RAPA/RAPB yalnız servisleri ÇAĞIRIR, yüklem taşımaz → çakışma yok, ama o dilim inmişse yeni helper adı kullanılır.
- `cloud-sync/report-requests.ts`, `patron/*`: yalnız R1-BULUT.

## 7 · Riskler ve geri alma

1. **Semantik katman ↔ mevcut rapor ayrışması (en büyük risk).** Önlem: karmaşık ölçü helper'a bağlı; R0 temel raporları mevcut servisleri ÇAĞIRIR (yeni SQL yok); iki eşitlik bekçisi (`test_temel_rapor_esitlik`, `test_semantik_sayi_esitligi`) iki yönlü kapsama ile.
2. **Yetki sızıntısı.** Paylaşım veri yetkisi vermez; blok başına izin; bulut kişi adı/audit dışlaması; negatif sondalı derleyici bekçisi.
3. **Tek process'i kilitleyen sorgu.** `statement_timeout` + iptal + semafor + kardinalite tavanı + çok dönem/varyant üst sınırı (12/6).
4. **Yanlış istatistik yorumu.** Maruziyet zorunlu, örneklem uyarısı, "ilişki ≠ neden", çoklu test düzeltmesi; R3 en son.
5. **Kapsam büyümesi (ikinci Metabase).** Blok türü 8 grafik ile sınırlı; ham SQL yok; R0 önce biter.
6. **Türkçe ek kenar durumları.** Ek gerektirmeyen yedek kalıp; altın vaka listesi büyür.
7. **Kesit raporlarında geçmiş kıyas.** Defterden hesaplanamıyorsa görüntü tablosu = defter sınıfı; karar kullanıcıda.
8. **Paket boyutu (web panel).** ECharts tembel yükleme; ağaç sallama (`echarts/core` + gereken grafikler).

**Bayrak ve geri alma:** `reports.v2Enabled` varsayılan **KAPALI** = bugünkü davranış (ölçülür: bayrak kapalıyken hub, route'lar, palet bayt bayt eski). Açılınca Rapor Merkezi gelir; eski 36 rapor "Eski raporlar" bölümünde ve kendi adreslerinde AÇIK kalır (bantlı, yönlendirmesiz). Geri alma = bayrağı kapatmak; veri kaybı yok (yeni tablolar yalnız ek; kayıtlı tanımlar durur). Yeni uçlar bayraktan bağımsız rapor kapısı + izinle korunur (patron bulutu bayrağa bağlı değildir). Migration geri alınamaz; yalnız EK tablo/kolon olduğu için eski sürüm yeni şemayla çalışır ("eski istemci ne yapar": eski panel yeni uçları hiç çağırmaz; eski patron uygulaması yeni anahtarları listede görmez çünkü uygulama yalnız tanıdığı anahtarları çizer — R1-BULUT ölçer). `minVersion` gerekmez.

## 8 · Veto listesi (kullanıcıya)

1. **P1 bayrak varsayılanı KAPALI** — açma zamanı ve kurulum (deneme fabrikası önce) sizin kararınız; açınca eski raporlar geçiş bölümünde kalır.
2. **Eski 36 raporun kaldırılması ve otomatik yönlendirme** — bu planda YOK; geçişten (ör. bir sürüm) sonra ayrı karar.
3. **14 temel raporun listesi ve birleştirmeler** (§5) — özellikle: Müşteri Karnesi'nin "Sipariş ve talep"e, Operatör İş Hacmi'nin "Üretim akışı"na katılması; Levent dengesi'nin ayrı rapor kalması.
4. **Tek fire tanımı** ("satılabilir olmaktan çıkan metre", üç kaynak, toplam oran basılmaz) ve **tek iptal oranı** kaynağı (`order-cancellation`).
5. **İki yeni izin** `report:builder`, `report:publish` ve hangi rollere gideceği (öneri: builder → Süpervizör, Muhasebe, Kalite, Üretim Planlama; publish → Süpervizör).
6. **Paylaşım kullanıcıya/herkese** (role değil; kullanıcı ↔ rol bağı DB'de kalıcı değil).
7. **Ay sonu kesit görüntüsü** (Depo/Alacaklar geçmiş kıyası için) defter sınıfı yeni tablo gerekirse açılsın mı (R1-ZAMAN ölçümünden sonra).
8. **Desen boyutu** DOKUMA S2'nin `weaveDesignId`ine bağlı; o inene kadar "Ürün (kumaş)" desen yerine geçer.
9. **Persona şablonları** (RAP-R1: Patron ve Dokuma şefi şablonu yok; Depo & Sevkiyat sevk raporunu göremiyor) — bu planda dokunulmadı; ayrı karar.
10. **Patron uygulamasına giden v2 raporlar** (`production/uretim-akisi` kişi adı yüzünden hariç) ve bulut 0.x dağıtımının zamanı.
11. **Yeni paketler** (K2'de onaylı): `echarts`, `react-grid-layout`, `react-querybuilder`, `@codemirror/lang-json` (+ belge ile ortak `@uiw/react-codemirror`), `simple-statistics`.
