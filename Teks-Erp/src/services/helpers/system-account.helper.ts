// =============================================================================
// TeksERP — GİZLİ HESAP (satıcı/süperadmin) SÜZGECİ — TEK KAYNAK
// =============================================================================
// `User.isSystemAccount` bir SATICI hesabını işaretler: DB'de gerçek bir satır
// (audit ve FK gerçek kullanıcı ister), ama fabrikanın kullanıcı/oturum/aktör
// yüzeylerinde GÖRÜNMEZ. Süzgeç 12 ayrı yüzeye dağılıyor ve tasarım §12 kural 7
// bu yüzden TEK KAYNAK istiyor: elle kopyalanırsa "unutulmuş altıncı yüzey"
// doğar (bu repoda birden çok kez ölçülmüş bir sınıf).
//
// DÖRT SINIF VAR ve ayrımları LOAD-BEARING:
//
//   1. `VISIBLE_USER`             → doğrudan `prisma.user.*` sorguları.
//   2. `visibleUserWhere(extra)`  → aynısının fonksiyon hâli; ⚠️ süzgeç SONDA
//      spread edilir, yani çağıran onu KAZARA EZEMEZ. Bu, fason helper'ının
//      (`fason-open-dispatch.helper.ts`) sırasının TERSİDİR ve bilinçlidir:
//      orada sabit bir iş kuralıdır, burada bir GÜVENLİK yüklemidir.
//   3. `VISIBLE_ACTOR`            → aktör ilişkisi ZORUNLU olan modeller
//      (WorkSession.userId NOT NULL).
//   4. `VISIBLE_ACTOR_OR_SYSTEM`  → aktör ilişkisi NULLABLE olan modeller
//      (SystemLog / SystemLogArchive). ⚠️ Orada düz `{ user: VISIBLE_USER }`
//      yazmak `userId = null` olan SİSTEM olaylarını (login hatası, boot job'ı,
//      arşivleyici) listeden SESSİZCE düşürür — 2 Eyl fabrika dump'ının TAZE
//      restore'unda 16241 audit satırının 641'i (%3.9) tam olarak budur
//      (spec'teki 18509/1952 rakamı test artığı biriken çalışma DB'sinden
//      alınmıştı; D1/D3 ölçtü). Hata vermeyen bir audit boşluğu; "unutulmuş
//      enum" sınıfının audit sürümü.
//
// ⚠️ AUDIT LİSTESİ SÜZÜLMEZ (karar #8 — tam iz). SystemLog satırları KALIR;
// gizlenen şey AKTÖRÜN KİMLİĞİdir ve bunu `maskSystemActor` yapar. Süzgeç
// yalnız aktör DROPDOWN'ına (kim filtresi) uygulanır. `VISIBLE_ACTOR_OR_SYSTEM`
// bu yüzden bugün yalnız SÖZLEŞMEdir: nullable-aktörlü bir yüzey GERÇEKTEN
// süzmek zorunda kalırsa doğru yazımı burada bulur.
//
// HAM SQL: Prisma where'i iki raporu KAPSAMAZ (`reports/audit.report.service`,
// `reports/production.report.service` — ikisi de `JOIN users`). Onlar için
// aşağıdaki SQL parçaları var ve TAKMA AD `u` SÖZLEŞMEDİR.
//
// ⚠️ `as const` KULLANILMAZ (fason helper'ının gerekçesi birebir geçerli:
// readonly literal, Prisma'nın mutable input tipine oturmaz).
// ⚠️ Sabitler MUTATE EDİLMEZ — daima spread ile kopyalanır.
//
// Bekçi: `scripts/test_superadmin_hidden_single_source.ts` (kopya yazımı yasak,
// muafiyet İKİ YÖNLÜ) + `scripts/test_superadmin.ts` (davranış).
// =============================================================================

import { Prisma } from "@prisma/client";

/** Fabrika yüzeylerinde GÖRÜNEN kullanıcı: sistem hesabı olmayan. */
export const VISIBLE_USER: Prisma.UserWhereInput = { isSystemAccount: false };

/**
 * `prisma.user.*` where'i — ek koşullar ÖNCE, süzgeç SONDA.
 *
 * Sıra güvenliktir: `visibleUserWhere({ isSystemAccount: true })` bile sistem
 * hesabını AÇAMAZ. Çağıran listesi genişledikçe bu tek yerde kalır.
 */
export function visibleUserWhere(extra?: Prisma.UserWhereInput): Prisma.UserWhereInput {
  return { ...(extra ?? {}), ...VISIBLE_USER };
}

/** Aktör ilişkisi ZORUNLU olan modeller (WorkSession). */
export const VISIBLE_ACTOR = { user: VISIBLE_USER };

/**
 * Aktör ilişkisi NULLABLE olan modeller (SystemLog / SystemLogArchive).
 * `userId = null` sistem olayları KORUNUR — düz yazım onları düşürür.
 */
export const VISIBLE_ACTOR_OR_SYSTEM = {
  OR: [{ userId: null }, { user: VISIBLE_USER }],
};

// -----------------------------------------------------------------------------
// AUDIT TAKMA ADI (karar #8: tam iz, nötr kimlik)
// -----------------------------------------------------------------------------

/** Audit yüzeylerinde sistem hesabının gösterilen kullanıcı adı. */
export const SYSTEM_ACTOR_USERNAME = "sistem";
/** Aynı hesabın gösterilen tam adı (`User.fullName` de doğuşta bu değerdir). */
export const SYSTEM_ACTOR_FULLNAME = "Sistem Bakımı";

/**
 * Audit satırının aktörünü nötrler.
 *
 * ⚠️ `id` KORUNUR ve bu bilinçlidir: audit satırının kimlikle bağı kopmasın
 * (aynı aktörün satırları gruplanabilsin). Sızıntı zinciri id'de değil, id ile
 * çağrılabilen uçlarda kapanır: `/api/admin/users/:id*` sistem hesabında 404
 * verir (`middlewares/system-account.middleware.ts`), yani id ile ne künye ne
 * DÜZ PIN okunabilir.
 *
 * ⚠️ `username` .env'den gelen gerçek kullanıcı adı DEĞİL, sabit "sistem"tir —
 * o ad giriş için kullanılan bir sırdır ve `username` 78 ayrı select'te tel
 * üstündedir (hepsini daraltmak sözleşme kırar; doğru çözüm nötrlemektir).
 */
export function maskSystemActor<T extends { username: string; fullName: string; isSystemAccount?: boolean }>(
  user: T | null | undefined,
): Omit<T, "isSystemAccount"> | null {
  if (!user) return null;
  // ⚠️ `isSystemAccount` HER ZAMAN DÜŞÜRÜLÜR — sistem hesabında da, normal
  // kullanıcıda da. Alan yalnız maskeleme kararının GİRDİSİdir; yanıta
  // sızarsa "bu aktör satıcıdır" bilgisini aynen ilan eder ve takma adı
  // anlamsız kılar. Yan fayda: yanıt şekli değişiklik ÖNCESİYLE birebir aynı
  // kalır ({ id, username, fullName }), yani istemci sözleşmesi bozulmaz.
  const { isSystemAccount, ...rest } = user;
  if (!isSystemAccount) return rest;
  return { ...rest, username: SYSTEM_ACTOR_USERNAME, fullName: SYSTEM_ACTOR_FULLNAME };
}

/** Audit select'lerinde aktörün nötrlenebilmesi için gereken alanlar. */
export const ACTOR_SELECT = {
  id: true,
  username: true,
  fullName: true,
  // ⚠️ `maskSystemActor` bu alan OLMADAN sessizce no-op'a düşer (undefined →
  // "normal kullanıcı"). Aktör seçen her select'te bulunmak ZORUNDA.
  isSystemAccount: true,
} as const;

// -----------------------------------------------------------------------------
// HAM SQL PARÇALARI — takma ad `u` SÖZLEŞMEDİR
// -----------------------------------------------------------------------------

/**
 * WHERE parçası: sistem hesabının satırını düşürür.
 *
 * ⚠️ `IS NOT TRUE`, `= false` DEĞİL. LEFT JOIN'de `u` NULL olabilir ve `= false`
 * o satırları da düşürürdü — yani nullable tuzağının ham SQL ikizi.
 */
export const SQL_VISIBLE_USER = Prisma.sql`u."isSystemAccount" IS NOT TRUE`;

/**
 * SELECT parçası: kullanıcı adını sistem hesabında nötrler.
 *
 * ⚠️ Sabit `Prisma.raw` ile GÖMÜLÜR, `${}` ile DEĞİL. Sebep: `${}` bir BIND
 * PARAMETRESİ üretir ve aynı parça hem SELECT'te hem GROUP BY'da kullanıldığında
 * iki FARKLI parametre numarası ($1 / $3) doğar; PostgreSQL ifadeleri metinsel
 * karşılaştırdığı için o iki ifade "aynı" sayılmaz ve sorgu
 * "column must appear in the GROUP BY clause" ile düşer. Değerler bu dosyada
 * tanımlı ASCII/Türkçe sabitlerdir — dışarıdan gelmez, enjeksiyon yolu yoktur.
 */
export const SQL_ACTOR_USERNAME = Prisma.sql`CASE WHEN u."isSystemAccount" THEN ${Prisma.raw(`'${SYSTEM_ACTOR_USERNAME}'`)} ELSE u.username END`;

/** SELECT parçası: tam adı sistem hesabında nötrler (aynı gerekçe). */
export const SQL_ACTOR_FULLNAME = Prisma.sql`CASE WHEN u."isSystemAccount" THEN ${Prisma.raw(`'${SYSTEM_ACTOR_FULLNAME}'`)} ELSE u."fullName" END`;
