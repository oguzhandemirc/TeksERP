// =============================================================================
// KOD TEKİLLİĞİ — büyük/küçük harf farkı SAYILMAZ (2026-08-15, denetim §18)
// =============================================================================
// SAHA VAKASI: canlı fabrika verisinde `SANTUK` (ad: BORANCIK) ile `santuk`
// (ad: ŞANTUK) yan yana duruyor — İKİ FARKLI ÜRÜN, AYNI KOD. Ad-mükerrer
// guard'ı (`assertNameNotDuplicate`) bunu yakalayamaz çünkü ADLAR gerçekten
// farklı; kod guard'ı da yakalayamıyordu çünkü tekillik
// `findFirst({ where: { code } })` ile **TAM EŞLEŞME** arıyordu. Aynı desen
// `sefa`/`SEFA` (MİKRO CANVAS vs MIKROCANVAS) ve `bgr150seffaf`/`BGR150SEFFAF`
// çiftlerinde de var.
//
// Bu sistemde kod KİMLİKTİR ("tek kod kuralı", `utils/code-format.ts`): etikete
// basılır, belgede görünür, dış eşleşmede kullanılır. İki kayıt aynı kimliği
// taşıyamaz — harf büyüklüğü bir kimlik farkı değildir.
//
// Ölçüm (2026-08-15, yerel fabrika-sim DB'si): 218 üründe 8 çakışma grubu /
// 9 fazla satır; üçünde İKİ TARAF DA AKTİF.
//
// KAPSAM — yalnız MANUEL kodlu modeller:
//   Item · QualityGrade · PeripheralDevice · Subcontractor ·
//   SubcontractorCategory · CustomerBranch.code (şube ihracat kodu)
// `autoCode` taşıyan modellerde (Color/DefectType/Station/Machine/Route/
// ProductRecipe/ReturnReason/Customer) istemci kodu `delete data[codeField]`
// ile düşürülür → açık YAPISAL OLARAK yoktur, oralara guard eklenmez.
//
// TARİHSEL KAYITLAR PATLATILMAZ (ad guard'ının emsali, base.service.ts:163-171):
//   • DB unique kısıtı (`CREATE UNIQUE INDEX … ON items(upper(code))`) EKLENMEZ —
//     bugün 9 satır ihlal ediyor, migration hem dev'de hem sahada patlardı ve
//     migration'lar geri-alınamaz kabul edilir. Sed ancak tarihsel çiftler
//     kapatıldıktan SONRA, ayrı bir iş olarak eklenebilir (o gün
//     `scripts/test_db_invariants.ts` → EXPRESSION_UNIQUES envanterine de yazılır).
//   • Yalnız YENİ mükerrer engellenir; update kontrolü yalnız kod GERÇEKTEN
//     (katlanmış hâliyle) değişirken koşar → mevcut ikizler düzenlenebilir kalır.
//   • Mevcut kodlar YENİDEN YAZILMAZ. "Hepsini büyük harfe çevirelim" cazip ama
//     yanlış: 218 kodun 158'i büyük harfli değil ve o kodlar kâğıda basılmış
//     durumda. Katlama YALNIZ karşılaştırma anahtarıdır.
// =============================================================================

import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { foldCodeForCompare } from "../../utils/code-format";

/**
 * Kod tekilliği advisory lock namespace'i (2 argümanlı form).
 * Uzay envanteri TEK KAYNAK: `helpers/period-guard.helper.ts` başlığı — kopya
 * liste tutulmaz. Bu uzay **8029 kod tekilliği**dir.
 * ⚠️ 8026'DAN TAŞINDI: kod tekilliği ile CARİ dönem kapanışı aynı numarayı
 * paylaşıyordu ve iki alakasız alt sistemi `hashtext` çakışmasında sessizce
 * serileştiriyordu (yanlış sonuç değil, teşhisi imkânsız gecikme).
 * ⚠️ 1-argümanlı `pg_advisory_xact_lock(bigint)` formu bu kod tabanında HİÇ
 * KULLANILMIYOR (2026-08-15'te grep ile doğrulandı).
 */
// `: number` BİLEREK — literal tipe daralırsa bekçideki "namespace'ler farklı"
// karşılaştırması TS2367 ile derlenmez (SHIPMENT_LOCK_NS ile aynı gerekçe).
export const CODE_UNIQUE_LOCK_NS: number = 8029;

/**
 * Kod anahtarını tx ömrü boyunca kilitle — aynı katlanmış kodu yazmaya çalışan
 * iki eşzamanlı create'i serileştirir.
 *
 * NEDEN GEREKLİ: tam-eşleşme yarışını bugün DB'deki `@unique` kapatıyor
 * (P2002 → 409). KATLANMIŞ tekillikte DB'de karşılık YOK (bilinçli, yukarı bak)
 * → eşzamanlı `sefa2` + `SEFA2` istekleri guard'ı ikisi de geçer, P2002 doğmaz
 * ve yeni bir ikiz sessizce doğar. KK1 tuzağında birebir bu yaşandı ve ölçüldü.
 *
 * ⚠️ SIRA LOAD-BEARING: kilit, koruduğu OKUMADAN önce alınmalı. `findMany`
 * sonrasına konursa hiçbir şey kazanılmaz.
 *
 * `scope` model başınadır ("item", "subcontractor"…) — farklı tabloların aynı
 * kodu birbirini beklemesin.
 */
export async function lockCodeScopeTx(
  tx: Prisma.TransactionClient,
  scope: string,
  code: string,
): Promise<void> {
  // void dönüşü int'e sarılmadan dışarı çıkmaz — pg adapter void kolonu
  // deserialize edemiyor (shipment-locks.helper ile aynı gerekçe).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CODE_UNIQUE_LOCK_NS}::int, hashtext(${`${scope}|${foldCodeForCompare(code)}`}))`;
}

/** Karşılaştırmaya giren aday satır (tek `findMany` ile çekilir, JS'te katlanır). */
export interface CodeCandidate {
  id: string;
  code: string | null;
  /** 409 mesajında çakışan kaydı tanıtmak için — operatör "ama öyle bir kayıt yok" demesin. */
  name?: string | null;
  isActive?: boolean | null;
}

/** Metin kalıpları — eski 409 sözleşmeleri (test/istemci) korunsun diye dışarıdan verilir. */
export interface CodeUniquenessTexts {
  /**
   * TAM eşleşmeli AKTİF çakışmanın İLK CÜMLESİ. Mevcut mesajlar birebir
   * korunur ("Bu kod ile aktif ürün zaten var" / "Bu code ile aktif kayıt
   * zaten var"); yalnız arkasına çakışan kaydın kimliği eklenir.
   */
  activeExactLead: string;
  /** Türkçe varlık adı ("ürün", "kalite sınıfı", "fason firma"…). */
  entityLabel: string;
}

export type CodeUniquenessDecision =
  | { kind: "FREE" }
  /**
   * TAM EŞLEŞMELİ pasif kayıt bulundu → diriltme yolu (eski davranış birebir).
   * ⚠️ Yalnız harf farkıyla eşleşen kayıt BURAYA DÜŞMEZ — 409 fırlatılır
   * (gerekçe: `decideCodeUniqueness` docstring'i).
   */
  | { kind: "REACTIVATE"; target: CodeCandidate };

/** `'SEFA' (MIKROCANVAS)` — mesajda çakışan kaydı somut gösterir. */
function describe(c: CodeCandidate): string {
  const name = typeof c.name === "string" && c.name.trim().length > 0 ? ` (${c.name})` : "";
  return `'${c.code ?? "-"}'${name}`;
}

/**
 * Katlanmış hâli verilen kodla aynı olan adaylar (kodsuz satırlar elenir).
 *
 * ⚠️ DETERMİNİSTİK SIRALANIR (kod, sonra id). `findMany` `orderBy` taşımıyor ve
 * PG satır sırasını garanti etmez → sırasız bırakılsaydı aynı istek, VACUUM/HOT
 * güncellemesi sonrası 409 mesajında BAŞKA bir kaydı gösterebilirdi. Mesajın var
 * oluş amacı ("operatör 'ama öyle bir kayıt yok' demesin") destek talebinde
 * tekrar üretilebilir olmasına bağlı.
 */
function matchesOf(code: string, candidates: readonly CodeCandidate[]): CodeCandidate[] {
  const target = foldCodeForCompare(code);
  return candidates
    .filter((c) => typeof c.code === "string" && foldCodeForCompare(c.code) === target)
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "", "tr") || a.id.localeCompare(b.id));
}

/**
 * CREATE yolu: kod serbest mi, yoksa TAM EŞLEŞMELİ pasif bir kayıt mı diriltilecek?
 *
 * ── KARAR AĞACI (sıra load-bearing) ────────────────────────────────────────
 *   1. TAM EŞLEŞME (bayt bayt aynı kod) var mı?
 *        • aktif  → 409 (`activeExactLead`)  ← eski davranış birebir
 *        • pasif  → REACTIVATE               ← eski davranış birebir
 *   2. Yalnız HARF FARKIYLA eşleşen kayıt(lar) → **409, diriltme YOK**.
 *
 * ⚠️ 1. adım 2'den ÖNCE gelmek ZORUNDA. Erken bir taslakta "aktif eş varsa
 * koşulsuz 409" yazılmıştı ve bu, canlı veride ÇALIŞAN bir yolu sessizce
 * öldürüyordu: `ACTIVO` (aktif) + `activo` (pasif) yan yana duruyor (aynı desen
 * `BAYROFLAM`/`bayroflam` ve `OSLO`/`oslo` çiftlerinde de var). Kullanıcı pasif
 * `activo` ürününü geri getirmek için kodu BİREBİR yazdığında 409 alıyor, üstelik
 * mesaj kastettiğinden BAŞKA bir kaydı ("ACTIVO") gösteriyordu. Tam eşleşme bir
 * çıkarım değil, kullanıcının yazdığı kimliğin ta kendisidir — ve bu dosyanın
 * kendi politikası "tarihsel ikizler düzenlenebilir kalır" der; var olan bir
 * satırı diriltmek YENİ bir ikiz yaratmak değildir.
 *
 * ⚠️ 2. adımda DİRİLTME YAPILMAZ (2026-08-15 denetim düzeltmesi; bir önceki
 * taslakta yapılıyordu). Sebep somut: diriltme yolu diriltilen kaydın **adını ve
 * birimini EZER, izinli renk/özellik listelerini SİLER**, ama `Item.itemType`'ı
 * yazmaz — ve `itemType` update'te FORBIDDEN'dır (`item.service.ts`). Yani pasif
 * `kate` (FABRIC) dururken `KATE` + `itemType: YARN` gönderen kullanıcı, yanıtta
 * yeşil "yeniden aktive edildi" görür; ürün FABRIC kalır ve bir daha
 * DÜZELTİLEMEZ. Kullanıcının HİÇ YAZMADIĞI bir kodu taşıyan kaydı bu kadar
 * yıkıcı biçimde canlandırmak, dosyanın kendi "belirsizlik sessizce çözülmez"
 * kuralının ihlaliydi. 409 fail-closed'dır ve mesaj çıkış yolunu söyler.
 *
 * Canlı emsal: `MC155`/`Mc155`/`mc155` — üçü de pasif, üç FARKLI ad
 * (V-1429/V-1430/V-1431). "Hangisi dirilecek" sorusunun doğru bir sessiz cevabı
 * yoktur; tek eş olduğunda da yoktur, yalnız yanlış cevap daha az görünürdür.
 */
export function decideCodeUniqueness(
  code: string,
  candidates: readonly CodeCandidate[],
  texts: CodeUniquenessTexts,
): CodeUniquenessDecision {
  const matches = matchesOf(code, candidates);
  if (matches.length === 0) return { kind: "FREE" };

  // 1) TAM EŞLEŞME her zaman kazanır — kullanıcının yazdığı kimlik budur.
  const exact = matches.find((c) => c.code === code) ?? null;
  if (exact) {
    if (exact.isActive === true) {
      throw AppError.conflict(`${texts.activeExactLead} — ${describe(exact)}.`);
    }
    return { kind: "REACTIVATE", target: exact };
  }

  // 2) Yalnız harf farkı → kimlik çakışması. Diriltme YOK (yukarıdaki gerekçe).
  const active = matches.filter((c) => c.isActive === true);
  const list = matches.map(describe).join(", ");
  throw AppError.conflict(
    active.length > 0
      ? `'${code}' kodu mevcut ${describe(active[0])} kaydıyla çakışıyor — ${texts.entityLabel} kodları büyük/küçük harf farkına bakılmaksızın tekildir. Farklı bir kod girin.`
      : `'${code}' kodu PASİF ${list} kaydıyla çakışıyor — ${texts.entityLabel} kodları büyük/küçük harf farkına bakılmaksızın tekildir. O kaydı listeden bulup aktifleştirin ya da farklı bir kod girin.`,
  );
}

/**
 * UPDATE yolu: kod bir başkasında kullanılıyor mu? Diriltme YOKTUR — pasif eş de
 * reddedilir (update sırasında başka bir kaydı canlandırmak anlamsız olurdu).
 *
 * ⚠️ Çağıran bunu YALNIZ kod GERÇEKTEN (katlanmış hâliyle) değişirken çağırır;
 * aksi halde tarihsel ikizin KENDİSİ düzenlenemez hâle gelir (kendi ikizine
 * çarpar) — ad guard'ının aynı kuralı, base.service.ts:729-751.
 */
export function assertCodeAvailable(
  code: string,
  candidates: readonly CodeCandidate[],
  texts: CodeUniquenessTexts,
): void {
  const matches = matchesOf(code, candidates);
  if (matches.length === 0) return;
  const hit = matches.find((c) => c.isActive === true) ?? matches[0];
  throw AppError.conflict(
    hit.isActive === true
      ? `'${code}' kodu ${describe(hit)} kaydında zaten kullanılıyor — ${texts.entityLabel} kodları büyük/küçük harf farkına bakılmaksızın tekildir.`
      : `'${code}' kodu PASİF ${describe(hit)} kaydında kullanılıyor — ${texts.entityLabel} kodları büyük/küçük harf farkına bakılmaksızın tekildir. O kaydı aktifleştirin ya da farklı bir kod girin.`,
  );
}
