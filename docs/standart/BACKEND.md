# Backend — `Teks-Erp/` (Express 5 + Prisma 7)

Bu dosya backend'de **nasıl yazılır** sorusunu cevaplar: hangi katman neyi içerir, servis metodu nasıl kurulur, zarf ve hata hangi şekli alır.

Katman-üstü ilkeler [`ILKELER.md`](ILKELER.md) (`[IL-xx]` ile atıf yapılır), kural biçimi ve "yeni kodda zorunlu / devralınan baseline" ayrımı [`README.md`](README.md), kadans [`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md). Olaydan doğan yasaklar `docs/KOD-KURALLARI.md`'de, çekirdek değişmezler (atomik claim · audit tx dışında · advisory kilit ilk ifade · `details.code` · fail-closed kapılar) kök `CLAUDE.md`'de — **burada tekrarlanmaz, işaret edilir**.

⚠️ `Teks-Erp/CLAUDE.md` § Katmanlar'daki "controller'sız route bilinçli istisnadır" cümlesi 2026-09-05 ölçümüyle çürüdü (80 route dosyasının 45'i controller'sız). Kanonik cümle **[BE-02]**'dir.

---

## 1 · Katman sözleşmesi

**Routes → Controllers → Services → Prisma.** Alt katman atlanmaz; Prisma'ya inen tek katman servistir.

- **[BE-01]** Route ve controller `lib/prisma` import etmez ve `$transaction` açmaz; DB'ye inen her şey servistedir · zorlama: eslint:`no-restricted-imports` · kanıt: `eslint.config.mjs:107-121`; ölçüm — routes+controllers'ta 0 `$transaction`, 0 gerçek prisma import · devralınan: yok
- **[BE-02]** Yeni ucun varsayılan yazımı **controller'sız inline handler**'dır: `schema.parse(req.body ?? {})` → servis çağrısı → `res.status(N).json(result)`, iş mantığı/tx/audit/zarf YOK · zorlama: insan:"handler'da iş mantığı var mı" sorusu satır sayısından okunmaz · kanıt: `routes/reason-preset.routes.ts:97-104`; ölçüm — 672 handler'ın 323'ü inline, %79'u ≤25 satır, 60 satırı geçen TEK handler `admin.routes.ts:179` ve gerekçesi yorumda · devralınan: yok
- **[BE-03]** Controller yalnız iki ölçütte açılır: master-data CRUD (`new BaseController(service)`) ya da **≥4 uçlu aile** (özel controller); `extends BaseController` yazılmaz · zorlama: insan:uçların "aynı aile" olup olmadığı ada değil anlama bağlı · kanıt: ölçüm — 15 dosya `new BaseController`, 20 özel controller, `extends BaseController` 0/22 · devralınan: yok
- **[BE-04]** Route dosyası büyüdüğünde bölme ekseni **alt mount**'tur (`router.use("/alt", altRouter)`), controller açmak değil — alt router üstteki kapıyı miras alır · zorlama: insan:bölme kararı ölçüyle değil konu sınırıyla verilir · kanıt: `routes/finance.routes.ts:30-35`, `routes/finance-allocation.routes.ts:6`; ölçüm — 16 alt mount · devralınan: yok

## 2 · Katman içerikleri — ne içerir / ne içermez

| Katman | İçerir | İÇERMEZ |
|---|---|---|
| `routes/` | mount · kapı · Zod şeması · `@openapi` bloğu · ince handler | iş mantığı · `$transaction` · prisma · audit · zarf kurulumu |
| `controllers/` | Zod parse · servis çağrısı · `res.status().json()` | zarf · tx · prisma · iş kuralı |
| `services/` (+`reports/`) | iş kuralı · `$transaction` · claim · `AppError` · projeksiyon+DTO · **zarfı KURAR** · audit (tx dışında) | Express tipleri · Zod · HTTP statüsü |
| `services/helpers/` | saf yüklem + Prisma parçası (boğaz ikiz, [IL-02]) · `tx` alan ortak yazım | `ApiResponse` · Express tipi · HTTP zarfı |
| `services/reports/` | salt okuma · tek-tanım rapor dosyaları | yazma · tx · audit |
| `jobs/` | boot uzlaştırması · zamanlayıcı | HTTP · süreç dışı iş (backend TEK process) |
| `middlewares/` | kapı + zenginleştirme | iş kuralı · DB yazımı |

- **[BE-05]** `AuditService` route ve controller katmanından çağrılmaz; audit servis katmanının işidir · zorlama: insan:AST'den yakalanabilir ama 10 devralınan ihlal `error` yazımını engelliyor (README § ESLint ölçütü: ihlal düzeltilmeden kural yazılmaz) · kanıt: ölçüm — 10 çağrı / 3 dosya · devralınan: 10 (`admin.routes.ts` ×8, `db-copy.routes.ts:191`, `feature-flag.routes.ts:101`)
- **[BE-06]** `helpers/` HTTP zarfı kurmaz ve `ApiResponse` döndürmez; girdisi `tx` ya da saf değerdir, çıktısı ham veridir · zorlama: insan:"HTTP bilen helper" ile meşru route-handler fabrikası (BE-08) aynı AST şeklini taşır · kanıt: ölçüm — 106 helper dosyasının 106'sında `ApiResponse` 0 · devralınan: yok
- **[BE-07]** Servis Express `Request`/`Response` tipi almaz; ihtiyaç duyduğu her şey düz parametreyle geçirilir · zorlama: insan:BE-08 fabrikası ile aynı AST, ayrımı amaç belirler · kanıt: ölçüm — 22 imza / 11 dosya, jenerik liste sözleşmesi `base.service.ts:390 findAll(req)` üstüne kurulu · devralınan: 11 dosya (baseline)
- **[BE-08]** `services/helpers/guarded-hard-remove.ts` ayrı bir sınıftır — bağımlılık-guard'lı `/:id/permanent` **route-handler fabrikası**; yeni kalıcı-silme ucu bu fabrikadan doğar, guard listesi kopyalanmaz · zorlama: insan:fabrika olduğu ancak dosyanın amacından bilinir · kanıt: `guarded-hard-remove.ts:1-12` (üç ~60-100 satırlık kopya buradan silindi) · devralınan: yok
- **[BE-09]** `reports/` altındaki servis yazma, tx ve audit içermez · zorlama: insan:salt-okumalık çağrı zincirinin tamamına bakmayı ister · kanıt: ölçüm — 25 dosyada create/update/delete/`$transaction`/`AuditService` çağrısı 0 (tek eşleşme yorum satırı, `order-cancellation.report.service.ts:36`) · devralınan: yok
- **[BE-10]** Job'ın çok-model yazımı tek `$transaction` içindedir — yarıda kalan boot uzlaştırması yarım katalog bırakır · zorlama: insan:job'ın "çok-model yazım" olup olmadığı okumayla anlaşılır · kanıt: `jobs/role-template-catalog.job.ts:57` (tx YOK: `:118` update · `:147` create · `:172` createMany) · devralınan: 1 (İ-12, açık iş)

## 3 · Servis metodu anatomisi

Referans dosya: `src/services/sack-tag.service.ts`. Beş bölüm, sıra sabit.

```ts
export async function createX(
  input: { name: string; … },     // 1) İMZA: input | id → …, aktör userId? SON
  userId?: string,
): Promise<ApiResponse<XDto>> {
  const name = normalizeName(input.name);   // 2) UCUZ ÖN DOĞRULAMA — TX DIŞI
  await assertXAssignable(input.ids);       //    normalizeX (biçim) · assertX (geçerlilik)

  const row = await prisma.$transaction(async (tx) => {   // 3) TEK TX
    const claim = await tx.x.updateMany({                 //    atomik claim
      where: { id, status: XStatus.ACTIVE },
      data: { status: XStatus.DONE },
    });
    if (claim.count === 0) throw AppError.conflict("Durum değişti — yenileyip tekrar deneyin");
    const fresh = await tx.x.findUnique({ where: { id }, select: X_SELECT }); // claim SONRASI taze oku
    …                                                     //    yaz + sayaç
    return fresh;
  });

  await AuditService.log({                  // 4) TX SONRASI: audit (await), cache tazeleme
    userId, action: "CREATE", tableName: X_TABLE, recordId: row.id, newData: { ...row },
  });
  return { success: true, data: row, message: "Kayıt eklendi" };   // 5) ZARF servisin işi
}
```

Claim/kilit/audit-yerleşimi semantiği kök `CLAUDE.md` § Eşzamanlılık ve § Veri-defter'de; mekanizma seçimi `ESZAMANLILIK.md`'de.

- **[BE-11]** Servis metodu bu beş bölümden oluşur ve sıra değişmez · zorlama: insan:"ucuz doğrulama" ölçütü AST'den okunmaz · kanıt: `sack-tag.service.ts:125-152` (`createTag`), `:276-310` (`setSackTags`) · devralınan: yok
- **[BE-12]** Biçim ve geçerlilik doğrulaması saf yardımcılara çıkar (`normalizeX` biçim döndürür, `assertX` void + throw) ve **transaction'dan ÖNCE** koşar; tx içinde yalnız DB'ye bağlı kontrol kalır · zorlama: insan · kanıt: `sack-tag.service.ts:102-106` (`normalizeHex`), `:278-280` (`assertTagsAssignable`); ölçüm — `assert*` 61, `normalize*` 17 · devralınan: yok
- **[BE-13]** Aktör parametresi `userId?: string` ve **son** sıradadır · zorlama: insan:parametrenin anlamı addan, konumu kuraldan okunur · kanıt: ölçüm — 334 opsiyonel `userId` / 49 zorunlu · devralınan: yok
- **[BE-14]** Audit `tableName` değeri modül düzeyinde sabittir ve **geçmişin okunduğu modülü** söyler (katalog satırı ile o kataloğu kullanan nesne aynı ada yazılmaz) · zorlama: insan:doğru modül adı iş kararıdır · kanıt: `sack-tag.service.ts:32-37` (katalog `sack_tags`, atama `SACK`) · devralınan: yok

## 4 · Servis biçimi

- **[BE-15]** Yeni servis **düz fonksiyon modülüdür** (`export async function`) ya da `export const XService = { … }` nesnesidir · zorlama: insan:biçim AST'den okunur ama devralınan 77 class'ı ayıran şey dosyanın yaşıdır · kanıt: ölçüm — son 30 servis dosyasının 27'si fonksiyon; 2026-08-01 sonrası 114 fonksiyon / 27 class · devralınan: 77 dosya (baseline)
- **[BE-16]** Static-only class yalnız **altyapı** servisinde meşrudur (audit · auth · device · session · permission) · zorlama: insan:"altyapı mı domain mi" sınıflandırması mekanik değil · kanıt: ölçüm — 13 static-only class, tamamı bu beş konu · devralınan: yok
- **[BE-17]** Yeni yüzey mevcut mega servise metod eklemez, kendi `<konu>.service.ts` dosyasını açar · zorlama: insan:"yeni yüzey mi" kararı mekanik değil · kanıt: README § bilinen borç (5 mega servis, tepe `subcontractor.service.ts` 7.143 satır) · devralınan: yok

Dosya banner'ı ([IL-25]) ve yorum politikası ([IL-24]) burada da geçerlidir; 269 servis dosyasının 251'i banner'la açılır.

## 5 · Zarf ve hata şekli

- **[BE-18]** Yanıt zarfını (`{ success: true, data, message? }`) **SERVİS** kurar; route ve controller yalnız statüyü seçip basar · zorlama: insan:inline route'un kurduğu zarf ile servisin döndürdüğü nesne AST'de aynı `ObjectExpression` · kanıt: ölçüm — bugün üç üretici var: servis 597 `success:true` · inline route 106 · `reportEnvelope` 21 · devralınan: 106 inline route + 36 controller satırı (baseline)
- **[BE-19]** `reportEnvelope` üçüncü ve **tek meşru istisnadır**: yalnız `routes/reports/**` altında çağrılır, tanımı `services/reports/_shared.ts:157` · zorlama: insan:çağrı yeri dizinden okunur ama istisnanın kapsamı karardır · kanıt: ölçüm — 21 çağrı / 8 dosya, hepsi `routes/reports/` · devralınan: yok
- **[BE-20]** Kullanıcıya dönen her hata `AppError.<factory>` ile fırlatılır ve mesajı Türkçedir; `throw new Error` yalnız iç sentinel içindir · zorlama: insan:iç sentinel ile kullanıcı hatası AST'de aynı · kanıt: ölçüm — 1.922 `AppError` / 17 `new Error` · devralınan: yok
- **[BE-21]** Hata gövdesi **üç şekildedir** ve istemci üçünü de tanımak zorundadır: (a) `AppError` → `{success:false, message, details?}`; (b) Prisma/altyapı çevirisi → aynı şekil ama `details.code` **YOK** (9 dal: 23514 · 40001/40P01 · P2002 · P2025 · P2003 · P2007 · P2023 · P2020 · P2014/P2034); (c) `ZodError` → `{success:false, message:"Validasyon hatası", errors:[{field,message}]}` — `details` yerine `errors[]` · zorlama: insan:şekil sözleşmesi iki repoda yaşıyor ([IL-08]) · kanıt: `middlewares/error.middleware.ts:417` (a), `:542-704` (b), `:789` (c) · devralınan: yok
- **[BE-22]** `details.code` **talep güdümlüdür**: yalnız Electron ya da mobil o kodda dallanacaksa yazılır, "ileride lazım olur" diye üretilmez · zorlama: insan:"istemci dallanacak mı" sorusu backend kodundan okunmaz · kanıt: ölçüm — üretim 98 (conflict 54 · badRequest 44), tüketim 41 (Electron 18 · mobil 23); 409'ların %10'u, 400'lerin %4'ü · devralınan: yok
- **[BE-23]** Statü sözlüğü sabittir: **400** doğrulama · **403** yetki ve kapalı modül · **404** yok (uzakta gizli) · **409** durum/yarış/idempotency; **422 kullanılmaz** · zorlama: insan:statü seçimi anlam kararıdır · kanıt: ölçüm — badRequest 1.006 · conflict 535 · notFound 374 · forbidden 32 · unauthorized 33; `utils/app-error.ts`'te 422 fabrikası yok · devralınan: yok

429'un `Retry-After` başlığı tek noktadan basılır (`error.middleware.ts:426`); süreyi hesaplayan yer yalnız `details.retryAfterSec` yazar.

## 6 · Projeksiyon ve tip

- **[BE-24]** Okuma projeksiyonu modül düzeyinde `const X_SELECT = { … } satisfies Prisma.XSelect` sabitidir · zorlama: tsc (`satisfies` yanlış alanı derlemede düşürür) · kanıt: `sack-tag.service.ts:39-47`; ölçüm — 34 `*_SELECT` sabiti, 18 `satisfies Prisma.*` · devralınan: 117 projeksiyonsuz okuma (1.549 çağrının %7'si)
- **[BE-25]** Servis metodunun dönüş tipi **adlandırılmış DTO**'dur; `Promise<ApiResponse<unknown>>` / `<any>` yeni kodda yazılmaz · zorlama: tsc · kanıt: ölçüm — 429 `ApiResponse` imzasının 211'i `unknown`/`any`, 17'si `Record<string,unknown>`, yalnız 7'si adlandırılmış Dto · devralınan: 211 imza (baseline)
- **[BE-26]** Okuma `select` ile yazılır; `include` yeni okumada kullanılmaz — yasak `Teks-Erp/CLAUDE.md` § DB kuralı 7'de · zorlama: insan:ilişki ağacını tümden isteyen meşru okuma ile tembellik AST'de aynı · kanıt: ölçüm — `select` 2.601 satır ↔ `include` 269 satır · devralınan: 269 satır (yığın: `subcontractor` 60 · `workorder` 50)
- **[BE-27]** Servis dosyasında `any` ve `@ts-ignore` yazılmaz · zorlama: eslint:`@typescript-eslint/no-explicit-any` · kanıt: ölçüm — 269 dosyada gerçek `any` 1, `@ts-ignore` 0 · devralınan: yok

## 7 · Adlandırma

Fiil sözlüğü, `*Tx` soneki, `$transaction` closure'ının `tx` olması ve UPPER_SNAKE/PascalCase/camelCase ayrımı [IL-17] · [IL-19] · [IL-20]'dedir. Backend'e özel ekler:

- **[BE-28]** Çağıranın transaction'ında koşmak zorunda olan **her** export fonksiyon `*Tx` ile biter; tek istisna sınıfı **esnek istemci** alan fonksiyonlardır (`tx` VEYA `prisma`) — onlara sonek yazmak yanlış olur · zorlama: insan:esnek istemci bilinçli bir sözleşmedir ve tipten değil gerekçeden bilinir · kanıt: ölçüm — 48 fonksiyonun 33'ü sonekli, 15'i soneksiz (tam liste `docs/history/standart-2026-09-05/olcum/faz0-acik-olcumler.json` § `I_02_tx_soneksiz_fonksiyonlar`); esnek: `helpers/customer-name.helper.ts:77`, `helpers/supplier-party.helper.ts:89` · devralınan: 13 (ada çevriliyor) + 2 (kalıcı istisna)
- **[BE-29]** Dosya adı türü söyler (`x.service.ts` · `x.helper.ts` · `x.routes.ts` · `x.controller.ts` · `x.middleware.ts` · `x.job.ts`) ve helper dosyası `helper` sonekini taşır · zorlama: insan:ad kalıbı AST'den ölçülmez ([IL-18]) · kanıt: ölçüm — 76 sonekli / 18 soneksiz helper · devralınan: 18 dosya

## 8 · Kapılar

- **[BE-30]** Yeni route dosyası kapısını **dosya başında** `router.use(verifyToken, requireXEnabled)` ile kurar; handler başına `verifyToken` yazmak fail-open desendir (yeni uç eklerken guard unutulunca uç sessizce public olur) · zorlama: bekçi:`scripts/test_route_auth_coverage.ts` · kanıt: `routes/batch.routes.ts:20-23` (gerekçe yorumda); ölçüm — 24 dosya toplu kapı, 53 dosya handler başına (244 argüman) · devralınan: 53 dosya (baseline)
- **[BE-31]** Kapı satırından **ÖNCE** uç tanımlanmaz — Express kayıt sırası yüzünden sonradan gelen kapıyı o uç hiç görmez, hata da log da çıkmaz · zorlama: bekçi:`test_route_auth_coverage.ts` · kanıt: ölçüm — 80 dosyada sıra ihlali 0 · devralınan: yok
- **[BE-32]** Her uç `requirePermission` / `requireAnyPermission` taşır; taşımayan uç bekçinin `EXEMPT` sözlüğünde gerekçesiyle durur · zorlama: bekçi:`test_route_auth_coverage.ts` (iki yönlü: ölü muaf da kırmızı) · kanıt: ölçüm — 377 `requirePermission` + 247 `requireAnyPermission`; muaf 6 dosya · devralınan: yok
- **[BE-33]** Modül kapısı ADLANDIRILMIŞ olur ve 403 gövdesi `details.code:"MODULE_DISABLED"` taşır · zorlama: bekçi:`scripts/test_module_flag_off.ts` (⚠️ finans kapısını KAPSAMIYOR) · kanıt: `middlewares/module.middleware.ts:76-83` (kod var) ↔ `middlewares/finance.middleware.ts:21-33` (kod YOK, 30 mount); jenerik `requireModule("x")` yasağı `eslint.config.mjs:51` · devralınan: 1 kapı / 30 mount (İ-04, açık iş)
- **[BE-34]** Mobil dokunan uç `requireAnyPermission('<web-izni>', ...MOBILE_X)` biçimindedir · zorlama: bekçi:`scripts/test_permission_catalog.ts` (katalogda olmayan kodu düşürür) · kanıt: ölçüm — 247 `requireAnyPermission`'ın 120'si mobil izni içeriyor; emsal `routes/reason-preset.routes.ts:33` · devralınan: yok

## 9 · Zod

- **[BE-35]** Zod şeması **route ya da controller** dosyasında, **modül düzeyinde** ve `Schema` sonekiyle tanımlanır; handler içinde şema kurulmaz · zorlama: insan:modül düzeyi AST'den okunur ama sonek konvansiyonu ada dayanır · kanıt: ölçüm — routes'ta 70 şemanın 70'i modül düzeyinde, sonek oranı 191/208 (%92); ayrı `*.schema.ts` dosyası açılmaz (tek istisna `config/label-kind.schema.ts`) · devralınan: 17 soneksiz şema
- **[BE-36]** Serviste Zod yoktur — doğrulama HTTP kenarında biter, servise tipli girdi ulaşır · zorlama: insan:paylaşılan helper üzerinden gelen 2 meşru kullanım aynı import'u üretir · kanıt: ölçüm — 269 servis dosyasında 2 kullanım, ikisi de paylaşılan helper · devralınan: 2
- **[BE-37]** Gövde `schema.parse(req.body ?? {})` ile ayrıştırılır; ham `req.body` servise geçirilmez — tek meşru istisna `BaseController` yoludur ve orada ikinci kapı `sanitizeWriteData` DMMF allowlist'idir · zorlama: insan:`BaseController` yolu ile denetimsiz cast AST'de ayırt edilemez · kanıt: ölçüm — 205 `parse(req.body`; `controllers/base.controller.ts:95-97,107-109` · devralınan: 2 (`routes/peripheral.routes.ts:133,184` ham cast — İ-05)
- **[BE-38]** **YENİ** şema `.strict()` ile yazılır; **devralınan** şemaya `.strict()` sonradan EKLENMEZ — allowlist davranışı değişir ve eski istemcinin fazladan alanı 400'e düşer · zorlama: insan:"yeni mi devralınan mı" ayrımı AST'de yok · kanıt: gerekçe emsali `controllers/shipping.controller.ts:71-81` (ölçülmüş vaka: `{ id }` gövdesi 200 dönüp müşteriyi sessizce siliyordu); bugün 50/208 (%24) · devralınan: 158 şema (baseline)
- **[BE-39]** Enum alanı Prisma enum'undan türetilir (`z.nativeEnum(PrismaEnum)`); literal ayna yalnız enum'un **bilinçli alt kümesi** için yazılır · zorlama: insan:tam ayna ile bilinçli daraltma AST'de aynı literal dizisi · kanıt: `routes/reason-preset.routes.ts:35`; alt küme emsali `controllers/shipping.controller.ts:68` · devralınan: 47 literal ayna (baseline)

## 10 · Swagger

- **[BE-40]** Her uç `@openapi` bloğunu **kendi route dosyasında**, tanımının hemen üstünde taşır · zorlama: bekçi:`scripts/test_swagger_spec.ts` (⚠️ bugün yalnız YAML geçerliliğini ve `PATH_COUNT_FLOOR=120` körlük zeminini ölçer; uç ↔ blok eşlemesini ÖLÇMEZ) · kanıt: `routes/batch.routes.ts:25-39`; ölçüm — 612/672 (%91) · devralınan: ~60 belgesiz uç

**Bilinen borç:** `test_swagger_spec.ts:27`'deki 120 yol zemini, canlı üretilen 502 yol karşısında ısırmıyor — bekçiyi kapsam eşlemesine çevirmek ayrı iştir. Sıfır bloklu 6 dosya (24 uç) ve en büyük boşluklar (`shipping.routes.ts` 58 uç/20 blok · `finance.routes.ts` 33/10) `docs/history/standart-2026-09-05/kesif/katman-sozlesmesi.json` § `swagger`'da listelidir.

## 11 · Boyut

Felsefe ve baseline mekanizması [IL-21] · [IL-22] · [IL-23]'te; satır = **kod satırı** (yorum ve boş satır sayılmaz). Backend'e özel tavanlar:

| Birim | Hedef | Ölçülen bugün |
|---|---|---|
| Route handler (inline) | ≤ 40 | %79'u ≤25; >60 satır olan 1 (gerekçeli) |
| Controller metodu | ≤ 40 | p50 14 / p90 29 |
| Helper dosyası | ≤ 300 | p50 135 / p90 306 / max 626 |
| Servis · route · controller dosyası | ≤ 400 (yeni dosyada asla >600) | servis p50 235 / p90 1.000 / max 7.142 |
| Fonksiyon | ≤ 60 | p50 10 / p90 72 / p99 244 |

- **[BE-41]** Bu tavanlar yeni ve dokunulan kodda zorunludur; devralınan dosyalar baseline'da donar ve tavan yalnız düşer · zorlama: [IL-21] ile aynı kapı (`scripts/check-lint-baseline.mjs`) · kanıt: ölçüm — bugünkü aşımlar: helper>300 **11** · helper>400 **3** · servis>400 **78** · servis>600 **49** · route>300 **22** (tepe `admin.routes.ts` 1.982) · devralınan: yukarıdaki sayılar (baseline)
- **[BE-42]** Bölme fırsatçıdır: dokunulan bölüm `helpers/<konu>.helper.ts`'e ya da alt router'a çıkar; 5 mega servisi bölmek ayrı iştir ve bu turda yapılmaz · zorlama: insan:bölme kararı konu sınırına bakar · kanıt: README § bilinen borç · devralınan: 5 dosya (sınır dışı)
