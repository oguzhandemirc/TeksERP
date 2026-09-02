-- =============================================================================
-- MODÜL ANAHTARLARI — GRANDFATHERING DAMGASI (P1, 2026-09-02)
-- =============================================================================
-- NEDEN MIGRATION (seed/job DEĞİL):
--   `requireTicaretEnabled` yazıldığı ANDA `ticaret.enabled`in DEĞERİ kodun
--   sözleşmesinin parçası olur. `prisma/seed.ts` YALNIZ ilk kurulumda koşar ve
--   saha kurulumu (`deploy/kur.ps1`) seed'i HİÇ çağırmaz — yalnız
--   `prisma migrate deploy`. Yani mevcut fabrikaya ULAŞAN tek otomatik yol
--   budur; "canlı DB'ye elle INSERT et" ise unutulabilir bir adımdır
--   (20260801020000 kurşun-bypass izin kataloğu vakası).
--   Emsal olumsuz: `finance.enabled` ne migration ne seed ile doğdu; bugün o
--   satır fabrikada YOK ve davranış yalnız `asBoolean(undefined) → false` kod
--   sigortasından geliyor. Modül anahtarlarında bunu tekrarlamıyoruz — değer
--   DB'de AÇIK BİR OLGU olur ki Modüller ekranı onu görebilsin.
--
-- NEDEN KOŞULLU (`WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)`):
--   `kur.ps1` YENİ kurulumda da tüm migration'ları koşar. Koşulsuz bir INSERT
--   taze bir DB'yi de damgalar ve kurulum profilini ("satır VARSA dokunma"
--   sözleşmesiyle yazacak boot job'ı) kalıcı no-op'a çevirirdi — her yeni
--   müşteri fabrika profiliyle doğardı. Grandfathering tanımı gereği yalnız
--   GEÇMİŞİ OLAN kuruluma aittir; boş DB kurulum profilinin işidir.
--
-- İDEMPOTENT: `system_settings.key` PRIMARY KEY → `ON CONFLICT DO NOTHING`.
--   Satır zaten varsa (panelden ya da `scripts/setup-ticaret.ts --apply` ile
--   açılmışsa) DOKUNULMAZ — fabrikanın kararı ezilmez.
--
-- ⚠️ `updatedAt` DEFAULT'SUZ ve NOT NULL (Prisma `@updatedAt` uygulama
--   katmanındadır, DB trigger'ı değil) → ELLE verilir, yoksa migration düşer.
-- ⚠️ DÜZ `now()`: kolonlar 20260801040000 ile `timestamptz`e çevrildi.
--   Kurşun-bypass migration'ındaki `now() AT TIME ZONE 'UTC'` kalıbı O-11
--   tuzağına karşıydı ve o dosya bu dönüşümden ÖNCE koşmuştu; burada
--   kopyalanırsa damga Europe/Istanbul'da 3 saat GERİYE yazılır.
-- ⚠️ `description` metinleri `setFeatureFlags` yazma dallarındakiyle BİREBİR
--   aynıdır (bekçi karşılaştırır) — ayrışırsa aynı satır, damgayı atan
--   kurulumda bir açıklamayla, panelden ilk düzenlemeden sonra başkasıyla
--   görünür.
--
-- ⚠️ DAMGA "DAVRANIŞI DEĞİŞTİRMEZ" CÜMLESİ ANCAK DEĞER VERİDEN TÜRETİLİRSE
--   DOĞRUDUR (2026-09-02 doğrulama turu, D1 major #3). İlk yazımda ticaret ve
--   iplik SABİT `false` damgalanıyordu; canlı ölçüm (dev kopyası) o kurulumda
--   `finance.enabled = true`, 3 alış siparişi, 80 fiyat satırı, 4 iplik stoğu
--   ve 2 sayım buldu — yani sabit damga o kurulumda DÖRT YÜZEYİ birden 403'e
--   düşürürdü. Bu dosyada artık YALNIZ ÜÇ anahtar sabittir; ticaret/iplik
--   dünkü davranıştan, çoklu depo ise depo sayısından türetilir.
-- =============================================================================

-- 1) SABİT DEĞERLİ ÜÇ ANAHTAR ---------------------------------------------------
--    production = true : bugün satır YOK ve `readProductionEnabled` satır
--                        yoksa TRUE döner. Damga o ÖRTÜK varsayılanı AÇIK BİR
--                        OLGUYA çevirir; kod sigortası yerinde KALIR (damgasız
--                        kopyada fabrika üretimsiz kalmasın).
--    kumasTeknik/tezgah = false : YER TUTUCU modüller — arkalarında bugün
--                        HİÇBİR yüzey (route · ekran · tablo) yok, yani
--                        "dünkü davranış" tanım gereği kapalıdır ve türetecek
--                        bir veri de yoktur. Sabit değer burada meşrudur.
INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT v.key, v.value, v.description, now(), now()
  FROM (VALUES
         ('production.enabled',  'true'::jsonb,
          'Üretim modülü (envanter üretim sekmeleri · iş emri yüzeyleri)'),
         ('kumasTeknik.enabled', 'false'::jsonb,
          'Kumaş teknik kartı modülü (en · gramaj · kompozisyon · atkı/çözgü)'),
         ('tezgah.enabled',      'false'::jsonb,
          'Dokuma tezgah izleme modülü')
       ) AS v(key, value, description)
 WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)
ON CONFLICT ("key") DO NOTHING;

-- 2) ticaret + iplik — DEĞER DÜNKÜ DAVRANIŞTAN TÜRETİLİR ------------------------
--    DÜN (bu migration'dan önce) alış siparişi · fiyat listesi · stok sayımı ·
--    iplik kg defteri router'ları `requireFinanceEnabled` taşıyordu. Yani o
--    dört yüzeyin AÇIK olup olmadığını belirleyen tek şey `finance.enabled`
--    satırıydı. Damga bu yüzden o değeri KOPYALAR:
--      finance.enabled = true  → ticaret/iplik AÇIK  (yüzeyler dün de açıktı,
--                                bugün de açık kalır — deploy sonrası aynı
--                                ekranlar aynı şekilde çalışır)
--      satır yok / false       → ticaret/iplik KAPALI (dün de 403'tü)
--    Adnan Şahin'de `finance.enabled` satırı YOK → ikisi de false, yani K13'ün
--    "sıfır görünür fark" kısıtı korunur. Sabit `false` yazmak ise finansı
--    AÇMIŞ bir kurulumda (demo · ticaret müşterisi) dört yüzeyi birden
--    kaybettirirdi ve başlıktaki "davranışı değiştirmez" cümlesi YALAN olurdu.
--
--    ⚠️ İKİSİ AYNI İFADEDEN doğar (`iplikEnabled → ticaretEnabled` bağımlılığı,
--    `constants/module-flags.ts`): iplik ticaretten önce açılamaz, bu yüzden
--    "ticaret false + iplik true" tutarsız çifti damgadan ÇIKAMAZ.
--    ⚠️ `value` JSONB — panelden yazılan satır `true`, ham ayar ucundan
--    yazılmış eski bir satır `'"true"'` (jsonb string) olabilirdi; ikisi de
--    kabul edilir (okuyucudaki `asBoolean` toleransının SQL ikizi).
--    ⚠️ `COALESCE(..., false)`: alt sorgu 0 satır dönerse (finance.enabled
--    satırı YOK) sonuç NULL olurdu ve `to_jsonb(NULL)` jsonb `null` yazardı —
--    `asBoolean` onu false okur ama `test_module_grandfathering §2c`nin
--    "değerler jsonb BOOLEAN" sözleşmesi kırılırdı.
INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT v.key, v.value, v.description, now(), now()
  FROM (VALUES
         ('ticaret.enabled',
          to_jsonb(COALESCE((SELECT "value" = 'true'::jsonb OR "value" = '"true"'::jsonb
                               FROM "system_settings" WHERE "key" = 'finance.enabled'), false)),
          'Ticaret modülü (alış siparişi · mal kabul · fiyat listeleri · stok sayımı)'),
         ('iplik.enabled',
          to_jsonb(COALESCE((SELECT "value" = 'true'::jsonb OR "value" = '"true"'::jsonb
                               FROM "system_settings" WHERE "key" = 'finance.enabled'), false)),
          'İplik modülü (kg defteri — iplik stok ve hareketleri)')
       ) AS v(key, value, description)
 WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)
ON CONFLICT ("key") DO NOTHING;

-- 3) depo.multiEnabled — DEĞER VERİDEN TÜRETİLİR --------------------------------
--    Bugünkü davranışı üreten tek kaynak panelin `useMultiWarehouse` yüklemi:
--      warehouses = AKTİF depolar (liste `filters: { isActive: "true" }`)
--      multiWarehouse = warehouses.length > 1
--    Sabit `false` yazmak, iki deposu olan bir kurulumda depo seçicilerini ve
--    kolonlarını sessizce KAYBETTİRİRDİ ("sıfır görünür fark" kısıtının ihlali).
--    ⚠️ `isActive` süzgeci load-bearing: atlanırsa pasifleştirilmiş eski bir
--    depo yüzünden TEK depolu fabrikada çoklu-depo yüzeyleri BELİRİR.
--    (20260706130000 `label.defaultMedia` emsali: veriden türetilmiş değer.)
--    ⚠️ BİLİNÇLİ DAVRANIŞ DEĞİŞİKLİĞİ: damgadan sonra ikinci depo açmak
--    yüzeyleri KENDİLİĞİNDEN açmaz — anahtar panelden açılmalıdır. Veri türevi
--    her istekte "modül açık mı" sorusunu farklı cevaplayabildiği için rejim
--    anahtarı olamazdı.
--
--    ⚠️ KOŞUL BURADA GENİŞ ve bu bilinçlidir (2026-09-02, D1 minor): `rolls`
--    koşuluna EK OLARAK "aktif depo > 1" de damgayı tetikler. Sebep ölçülmüş
--    bir boşluk: tanımlarını girmiş ama henüz üretime başlamamış (top=0) iki
--    depolu bir kurulumda damga hiç yazılmaz, okuyucu default `false` döner ve
--    depo seçici · depo kolonu · transfer yüzeyi KAYBOLURDU — üstelik panel
--    artık bu bayrağı okuduğu için (`useWarehouses`) veri türevine de
--    düşemezdi. Değer zaten veriden geldiği için koşulu genişletmek yanlış bir
--    damga üretemez: tek depolu taze kurulumda ikinci koşul da FALSE'tur.
INSERT INTO "system_settings" ("key", "value", "description", "createdAt", "updatedAt")
SELECT v.key, v.value, v.description, now(), now()
  FROM (VALUES
         ('depo.multiEnabled',
          to_jsonb((SELECT count(*) > 1 FROM "warehouses" WHERE "isActive" = true)),
          'Çoklu depo modülü (depo seçici · depo kolonu · depolar arası transfer)')
       ) AS v(key, value, description)
 WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)
    OR (SELECT count(*) FROM "warehouses" WHERE "isActive" = true) > 1
ON CONFLICT ("key") DO NOTHING;
