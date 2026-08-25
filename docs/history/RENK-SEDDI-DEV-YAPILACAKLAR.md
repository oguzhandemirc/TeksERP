# Renk mükerrer seddi — dev'de yapılacaklar

> ✅ **UYGULANDI — 2026-08-25, dev'de (`adnansahin` dalı).** Migration
> `20260825120000_color_name_unique_live`; SQL ikizi tüm BMP'de JS ile birebir ölçüldü
> (`test_fold_contract` §2b, 40/0). **Bu notun doğru çıkmayan iki iddiası uygulanmadı:**
> - §2 "Prisma ifade-UNIQUE'i DROP etmek ister, drift allowlist'e gir" → **YANLIŞ**: index
>   canlıdayken `test_schema_drift` 4/0 (mevcut `users_username_lower_uq` emsali). Şema notu
>   bu gerçekle yazıldı; allowlist'e dokunulmadı.
> - §4 "test_db_invariants §8 parmak izi — önerilir" → parmak izi eklendi ama asıl zorunlu
>   olan **§5 `EXPRESSION_UNIQUES` girdisiydi** (kapı iki yönlü: envanter-dışı index KIRMIZI);
>   bölüme predicate desteği eklendi.
> Ek düzeltmeler: `find_fold_duplicates` renk grubunu artık renk kuralıyla kurar (düz nameFold
> ile kördü); `ColorService.assertNameAvailable` tombstone'u dışlar (base.service ile hizalı);
> `error.middleware` `nameFoldColor`→"ad". Prod zemin ölçümleri (0 grup, 78/78 kod) dev
> kopyasında geçerli değildi — dev'e prod karar dosyası uygulanarak eşitlendi.
> Prod deploy: sıradan `migrate deploy`; NOTICE `index kuruldu` beklenir.

**Hazırlayan:** prod sunucuda ölçüm + prova (2026-08-25). **Prod'a hiçbir şey kurulmadı.**
Prova transaction içinde koşuldu ve ROLLBACK edildi; canlıda `tr_fold_color` fonksiyonu da,
`colors_nameFoldColor_key` index'i de **yok**.

---

## Neden düz `nameFold` UNIQUE DEĞİL

`schema.prisma` Color modelindeki not (2026-08-21) haklı: renk mükerreri **ayraç ve
sayı-sırası bağımsızdır** (`foldColorNameForCompare`, `name-normalize.helper.ts:98`).
Düz `nameFold` üzerine konan UNIQUE:

- `BEYAZ 330` ile `330-BEYAZ`'ı **AYNI SAYMAZ** (nameFold'ları farklı) → mükerrer geçer
- ama "sed kuruldu" görüntüsü verir → **uygulama kuralından zayıf, yanlış güven**

Bu yüzden aşağıdaki öneri, uygulama kuralının **SQL ikizi** üzerine kurulu.

## Kural (JS referansı)

```ts
// src/services/helpers/name-normalize.helper.ts:98
export function foldColorNameForCompare(name: string): string {
  const tokens = foldSearchText(name).split(/[\s-]+/).filter(Boolean);
  const numeric = tokens.filter((t) => /^\d+$/.test(t));
  const rest    = tokens.filter((t) => !/^\d+$/.test(t));
  return [...numeric, ...rest].join(" ");
}
```

Türkçe katla → `[\s-]+` ile böl → sayısal token'ları öne al (her grupta özgün sıra korunur) → boşlukla birleştir.

---

## 1) Migration — `prisma/migrations/<damga>_color_name_unique_live/migration.sql`

```sql
-- =============================================================================
-- RENK AD MÜKERRERİ — DB SEDDİ (uygulama kuralının SQL ikizi)
-- =============================================================================
-- Item/Customer/Subcontractor'da sed düz `nameFold` üzerinedir; RENKTE OLAMAZ:
-- renk mükerreri ayraç + sayı-sırası bağımsızdır ("055-BEYAZ" ≡ "BEYAZ 055").
-- Düz nameFold kısıtı uygulama kuralından ZAYIF olurdu (schema.prisma Color notu).
-- Bu yüzden kısıt `foldColorNameForCompare`'in SQL ikizi üzerine kurulur.
--
-- `tr_fold` zaten IMMUTABLE (20260819060000_search_fold) — ifade index'i için şart.
-- Predicate `mergedIntoId IS NULL`: birleştirme tombstone'ları adı bloke etmesin
-- (diğer üç seddin emsali). `isActive` süzgeci YOK — pasif eş de adı tutar,
-- ColorService.assertNameAvailable pasif eşe "aktifleştirin" 409'u veriyor.
-- =============================================================================

CREATE OR REPLACE FUNCTION "tr_fold_color"(txt text) RETURNS text AS $fn$
  SELECT coalesce(
    (SELECT string_agg(t, ' ' ORDER BY (t ~ '^[0-9]+$') DESC, ord)
       FROM unnest(regexp_split_to_array(tr_fold(txt), '[\s-]+')) WITH ORDINALITY AS u(t, ord)
      WHERE t <> ''), '')
$fn$ LANGUAGE sql IMMUTABLE;

-- YUMUŞAK KAPI (name_fold_unique_live emsali): mükerrer varsa index'i ATLA,
-- NOTICE bas, deploy'u DÜŞÜRME.
DO $$
DECLARE grup_sayisi int;
BEGIN
  SELECT count(*) INTO grup_sayisi FROM (
    SELECT 1 FROM "colors" WHERE "mergedIntoId" IS NULL
     GROUP BY "tr_fold_color"("name") HAVING count(*) > 1) z;

  IF grup_sayisi > 0 THEN
    RAISE NOTICE '[color_name_unique] ATLANDI — % mükerrer grup var; önce Sistem → Mükerrer Kayıtlar ile temizleyin, sonra bu dosyayı yeniden koşun', grup_sayisi;
  ELSE
    CREATE UNIQUE INDEX "colors_nameFoldColor_key"
      ON "colors" ("tr_fold_color"("name")) WHERE "mergedIntoId" IS NULL;
    RAISE NOTICE '[color_name_unique] index kuruldu';
  END IF;
END $$;
```

> Prod'da bugün **0 mükerrer grup** ölçüldü (2026-08-25, temizlik sonrası) → index KURULUR.

## 2) `schema.prisma` — Color modelindeki notu güncelle (~4486)

Mevcut not "RENKTE `nameFold` UNIQUE kısıtı BİLİNÇLİ OLARAK YOK" diyor. Gerekçe hâlâ
geçerli ama artık **eksik**: düz nameFold yok, ama `tr_fold_color(name)` üzerine
partial UNIQUE **var**. Notu şuna çevir:

```
/// ⚠️ RENKTE düz `nameFold` UNIQUE kısıtı YOK ve olmayacak: renk mükerreri ayraç +
/// sayı-sırası bağımsızdır (`foldColorNameForCompare`, "055-BEYAZ" ≡ "BEYAZ 055"),
/// düz kolon üzerine kısıt uygulama kuralından ZAYIF olurdu. Sed bunun yerine
/// `tr_fold_color(name)` İFADESİ üzerinde kuruludur (<damga>_color_name_unique_live):
/// `colors_nameFoldColor_key`, predicate `mergedIntoId IS NULL`.
/// Prisma ifade-UNIQUE'i datamodel'de temsil EDEMEZ → `migrate dev` DROP etmek ister,
/// ASLA uygulama (`--create-only` + DropIndex satırını sil). test_schema_drift allowlist'te.
```

## 3) `scripts/test_schema_drift.ts` — allowlist

`migrate diff` bu index'i "datamodel'de yok" sanıp DROP etmek isteyecek.

**ÖNCE ÖLÇ, SONRA YAZ:** dev'de migration'ı uygulayıp `npx tsx scripts/test_schema_drift.ts`
koş. Prisma ifade index'ini introspect **etmeyebilir** — o hâlde drift ÇIKMAZ ve
allowlist'e dokunmaya gerek kalmaz. Çıkarsa, testin bastığı ifadeyi **birebir**
`EXPECTED_DRIFT`'e ekle:

```ts
{
  sql: `DROP INDEX "colors_nameFoldColor_key"`,   // ← testin bastığı ifadeyi AYNEN yaz
  why: "renk ad seddi `tr_fold_color(name)` ifadesi üzerinde — Prisma ifade-UNIQUE'i datamodel'de temsil edemez",
},
```

> `tr_fold_color` **fonksiyonu** drift üretmez — `tr_fold` emsali (migration ile kurulur,
> schema.prisma'da yoktur, drift testi bugün temiz).

## 4) `scripts/test_db_invariants.ts` — bekçi (önerilir)

§8 `tr_fold` için "gövde parmak izi — JS ile birebir aynı çıktı" kontrolü var.
`tr_fold_color` için aynısını ekle; yoksa JS kuralı değişince SQL ikizi sessizce ayrışır
ve sed uygulamadan farklı davranmaya başlar. Prova edilmiş eşitlik örnekleri:

| Girdi A | Girdi B | `tr_fold_color` | Eşit mi |
|---|---|---|---|
| `055-BEYAZ` | `BEYAZ 055` | `055 beyaz` | ✅ |
| `330-BEYAZ` | `BEYAZ 330` | `330 beyaz` | ✅ |
| `GRİ-(292-7791)` | `292-7791-GRİ` | `gri (292 7791)` / `292 7791 gri` | ❌ **ayrışıyor** |

> Son satır bir **hata değil** — JS kuralı da parantezi token'a yapışık bırakıyor
> (`tr_fold` ile `foldSearchText` noktalama davranışı birebir aynı, invariants §8 doğruluyor).
> Yani SQL ikizi JS'i sadık taklit ediyor. Parantezli mükerrerleri yakalamak isteniyorsa
> **önce JS kuralı** değişmeli, SQL sonra.

## 5) Deploy

Sıradan migration; ek ops adımı yok, backfill yok, veri taşımıyor. Sadece:
`migrate deploy` sonrası NOTICE satırına bak — `index kuruldu` mu, `ATLANDI` mı.

---

## Prod'un bugünkü durumu (bu iş için zemin)

- Renk kodları **78/78** üretici formatında (`RNK` + GGAAYY + NNNN) — 49 eski tireli kod taşındı
- Uygulama kuralına göre **kalan renk mükerreri: 0** → sed ilk koşumda kurulur
- `customers` · `items` · `subcontractors` seddi **kurulu**, `test_db_invariants` **88/0**
- Renk kodu hiçbir etikete basılmıyor (2262 etiket anlık görüntüsünün 0'ında `colorCode`)
