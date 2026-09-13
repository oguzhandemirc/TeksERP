# Backend — HTTP KENARI (`Teks-Erp/`)

Bu dosya [`BACKEND.md`](BACKEND.md)'den **AİLE çizgisiyle** ayrıldı (2026-09-14): orada
servisin İÇİ (katman sözleşmesi · metot anatomisi · biçim · projeksiyon · adlandırma ·
boyut), burada **isteğin girip yanıtın çıktığı kenar** — zarf ve hata şekli, kapılar, Zod,
Swagger. Ortak imzaları şu: hepsi *istemciyle kurulan SÖZLEŞMEYİ* tarif eder ve kırıldığında
bedeli sahadaki istemci öder.

⚠️ **Bölüm numaraları KORUNDU** — `BACKEND.md §9` diye işaret eden çapalar (bugün
`docs/RECETELER.md`) kopmasın diye §5/§8/§9/§10 numaralarıyla taşındı; dosya §1'den
başlamaz. Kural kimlikleri (`BE-18`…`BE-41`) de değişmedi.

## 5 · Zarf ve hata şekli

- **[BE-18]** Yanıt zarfını (`{ success: true, data, message? }`) **SERVİS** kurar; route ve controller yalnız statüyü seçip basar · zorlama: insan:inline route'un kurduğu zarf ile servisin döndürdüğü nesne AST'de aynı `ObjectExpression` · kanıt: ölçüm — bugün üç üretici var: servis 597 `success:true` · inline route 106 · `reportEnvelope` 21 · devralınan: 106 inline route + 36 controller satırı (baseline)
- **[BE-19]** `reportEnvelope` üçüncü ve **tek meşru istisnadır**: yalnız `routes/reports/**` altında çağrılır, tanımı `services/reports/_shared.ts:157` · zorlama: insan:çağrı yeri dizinden okunur ama istisnanın kapsamı karardır · kanıt: ölçüm — 21 çağrı / 8 dosya, hepsi `routes/reports/` · devralınan: yok
- **[BE-20]** Kullanıcıya dönen her hata `AppError.<factory>` ile fırlatılır ve mesajı Türkçedir; `throw new Error` yalnız iç sentinel içindir · zorlama: insan:iç sentinel ile kullanıcı hatası AST'de aynı · kanıt: ölçüm — 1.922 `AppError` / 17 `new Error` · devralınan: yok
- **[BE-21]** Hata gövdesi **üç şekildedir** ve istemci üçünü de tanımak zorundadır: (a) `AppError` → `{success:false, message, details?}`; (b) Prisma/altyapı çevirisi → aynı şekil ama `details.code` **YOK** (9 dal: 23514 · 40001/40P01 · P2002 · P2025 · P2003 · P2007 · P2023 · P2020 · P2014/P2034); (c) `ZodError` → `{success:false, message:"Validasyon hatası", errors:[{field,message}]}` — `details` yerine `errors[]` · zorlama: insan:şekil sözleşmesi iki repoda yaşıyor ([IL-08]) · kanıt: `middlewares/error.middleware.ts:417` (a), `:542-704` (b), `:789` (c) · devralınan: yok
- **[BE-22]** `details.code` **talep güdümlüdür**: yalnız Electron ya da mobil o kodda dallanacaksa yazılır, "ileride lazım olur" diye üretilmez · zorlama: insan:"istemci dallanacak mı" sorusu backend kodundan okunmaz · kanıt: ölçüm — üretim 98 (conflict 54 · badRequest 44), tüketim 41 (Electron 18 · mobil 23); 409'ların %10'u, 400'lerin %4'ü · devralınan: yok
- **[BE-23]** Statü sözlüğü sabittir: **400** doğrulama · **403** yetki ve kapalı modül · **404** yok (uzakta gizli) · **409** durum/yarış/idempotency; **422 kullanılmaz** · zorlama: insan:statü seçimi anlam kararıdır · kanıt: ölçüm — badRequest 1.006 · conflict 535 · notFound 374 · forbidden 32 · unauthorized 33; `utils/app-error.ts`'te 422 fabrikası yok · devralınan: yok

429'un `Retry-After` başlığı tek noktadan basılır (`error.middleware.ts:426`); süreyi hesaplayan yer yalnız `details.retryAfterSec` yazar.

## 8 · Kapılar

- **[BE-30]** Yeni route dosyası kapısını **dosya başında** `router.use(verifyToken, requireXEnabled)` ile kurar; handler başına `verifyToken` yazmak fail-open desendir (yeni uç eklerken guard unutulunca uç sessizce public olur) · zorlama: bekçi:`scripts/test_route_auth_coverage.ts` · kanıt: `routes/batch.routes.ts:20-23` (gerekçe yorumda); ölçüm — 24 dosya toplu kapı, 53 dosya handler başına (244 argüman) · devralınan: 53 dosya (toplu kapısı OLMAYAN + handler başına `verifyToken,` taşıyan; kapı: `scripts/test_devralinan_tavan.ts` §2, yalnız düşer). ⚠️ "AŞILDI — 78" (2026-09-13) YANLIŞ ÖLÇÜMDÜ: `grep -rl "verifyToken,"` kuralın ÖNERDİĞİ `router.use(verifyToken, …)` satırını da sayıyordu; doğru yüklemle sayı 53, hiç yükselmedi.
- **[BE-31]** Kapı satırından **ÖNCE** uç tanımlanmaz — Express kayıt sırası yüzünden sonradan gelen kapıyı o uç hiç görmez, hata da log da çıkmaz · zorlama: bekçi:`test_route_auth_coverage.ts` · kanıt: ölçüm — 80 dosyada sıra ihlali 0 · devralınan: yok
- **[BE-32]** Her uç `requirePermission` / `requireAnyPermission` taşır; taşımayan uç bekçinin `EXEMPT` sözlüğünde gerekçesiyle durur · zorlama: bekçi:`test_route_auth_coverage.ts` (iki yönlü: ölü muaf da kırmızı) · kanıt: ölçüm — 377 `requirePermission` + 247 `requireAnyPermission`; muaf 6 dosya · devralınan: yok
- **[BE-33]** → **`docs/kurallar/modul-bayrak.md`** § Backend. Modül kapısının biçimi (adlandırılmış kapı + 403 `details.code:"MODULE_DISABLED"`) bu projenin MODÜL alanına aittir; kural 2026-09-13'te oraya TAŞINDI ve burada tekrarlanmaz.
- **[BE-34]** → **`docs/kurallar/yetki-izin.md`**. Mobil ucun izin biçimi (`requireAnyPermission('<web-izni>', ...MOBILE_X)`) bu projenin YETKİ alanına aittir, jenerik backend standardı değil; kural orada YAŞIYOR ve burada TEKRARLANMAZ. ⚠️ 2026-09-13'e kadar aynı cümle iki dosyadaydı — bir kural, onu ihlal edecek kişinin BAKACAĞI dosyada yaşar.

## 9 · Zod

- **[BE-35]** Zod şeması **route ya da controller** dosyasında, **modül düzeyinde** ve `Schema` sonekiyle tanımlanır; handler içinde şema kurulmaz · zorlama: insan:modül düzeyi AST'den okunur ama sonek konvansiyonu ada dayanır · kanıt: ölçüm — routes'ta 70 şemanın 70'i modül düzeyinde, sonek oranı 191/208 (%92); ayrı `*.schema.ts` dosyası açılmaz (tek istisna `config/label-kind.schema.ts`) · devralınan: 17 soneksiz şema
- **[BE-36]** Serviste Zod yoktur — doğrulama HTTP kenarında biter, servise tipli girdi ulaşır · zorlama: insan:paylaşılan helper üzerinden gelen 2 meşru kullanım aynı import'u üretir · kanıt: ölçüm — 269 servis dosyasında 2 kullanım, ikisi de paylaşılan helper · devralınan: 2
- **[BE-37]** Gövde `schema.parse(req.body ?? {})` ile ayrıştırılır; ham `req.body` servise geçirilmez — tek meşru istisna `BaseController` yoludur ve orada ikinci kapı `sanitizeWriteData` DMMF allowlist'idir · zorlama: insan:`BaseController` yolu ile denetimsiz cast AST'de ayırt edilemez · kanıt: ölçüm — 205 `parse(req.body`; `controllers/base.controller.ts:95-97,107-109` · devralınan: 2 (`routes/peripheral.routes.ts:133,184` ham cast — İ-05)
- **[BE-38]** **YENİ** şema `.strict()` ile yazılır; **devralınan** şemaya `.strict()` sonradan EKLENMEZ — allowlist davranışı değişir ve eski istemcinin fazladan alanı 400'e düşer · zorlama: insan:"yeni mi devralınan mı" ayrımı AST'de yok · kanıt: gerekçe emsali `controllers/shipping.controller.ts:71-81` (ölçülmüş vaka: `{ id }` gövdesi 200 dönüp müşteriyi sessizce siliyordu); bugün 50/208 (%24) · devralınan: 158 şema (baseline)
- **[BE-39]** Enum alanı Prisma enum'undan türetilir (`z.nativeEnum(PrismaEnum)`); literal ayna yalnız enum'un **bilinçli alt kümesi** için yazılır · zorlama: insan:tam ayna ile bilinçli daraltma AST'de aynı literal dizisi · kanıt: `routes/reason-preset.routes.ts:35`; alt küme emsali `controllers/shipping.controller.ts:68` · devralınan: 47 literal ayna (baseline)

## 10 · Swagger

- **[BE-40]** Her uç `@openapi` bloğunu **kendi route dosyasında**, tanımının hemen üstünde taşır; YENİ uç belgesiz olamaz · zorlama: bekçi:`scripts/test_swagger_spec.ts` (Express router ağacından uç listesi çıkarır ve spec ile İKİ YÖNLÜ karşılaştırır: baseline dışı belgesiz uç KIRMIZI, spec'te olup kodda olmayan hayalet blok KIRMIZI) · kanıt: `routes/batch.routes.ts:25-39`; ölçüm 2026-09-05 — 726 uç / 609 belgeli işlem · devralınan: 117 (`Teks-Erp/swagger-belgesiz-baseline.json`)
- **[BE-41]** Uç kaldırılınca `@openapi` bloğu da kaldırılır — spec'te kalan blok Swagger UI'da 404 veren bir uç ilan eder · zorlama: bekçi:`scripts/test_swagger_spec.ts` (hayalet blok kontrolü) · kanıt: 2026-09-05'te üç hayalet blok bulundu ve silindi (`reports/production.routes.ts`: `station-efficiency` · `machine-usage` · `scrap`) · devralınan: yok

**Devralınan tavan:** 117 belgesiz uç `Teks-Erp/swagger-belgesiz-baseline.json`da DONDURULDU; tavan **yalnız düşer** — belgelenen ya da kaldırılan uç baseline'dan çıkarılmazsa bekçi kırmızı verir (`--yaz` ile tazelenir). Yoğunlaştığı yerler: `shipping` 33 · `finance` 24 · `reports` 13 · `admin` 10. Toplu belgeleme ayrı iştir; bekçi yalnız YENİ borcu durdurur.

**Bilinen sınır:** eşleme Express'in canlı router ağacından çıkar — bekçi `src/app.ts`i import eder ve `Router.prototype.use`u geçici olarak yamalar (Express 5 Layer'ı mount yolunu saklamaz: `router/lib/layer.js` `this.path = undefined`). Yama tutmazsa uç sayısı çöker ve **körlük zemini** (`ENDPOINT_COUNT_FLOOR=500`) kırmızı verir.
