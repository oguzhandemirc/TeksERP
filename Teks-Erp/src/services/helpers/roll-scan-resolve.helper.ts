// =============================================================================
// TOP OKUTMA ÇÖZÜCÜSÜ — TEK BOĞAZ (D4-F1, DALGA4 §7.5; kararlar K11–K13)
// =============================================================================
// Okutulan kod → top. Sıra SABİT (K12): ① iç barkod (`Roll.barcode`) HER ZAMAN önce →
// ② `scan.customerCodeLookup` açıksa topa bağlı AKTİF müşteri kodu (`RollCustomerCode`) →
// 0 eşleşme: çağıranın bugünkü "bulunamadı"sı · ≥2 eşleşme: 409 `CUSTOMER_CODE_AMBIGUOUS` + adaylar
// (sessiz seçim YOK). Müşteri kodu `Roll.barcode`a ve `number_series`e girmez (K11); kalıtılmaz (K13).
//
// İKİNCİ ÇÖZÜCÜ YAZILMAZ: `rollCustomerCode` üzerinde `code` ile okuma yalnız bu dosyada
// (AST bekçisi `test_musteri_barkodu` §AST). Yeni bir okutma noktası müşteri koduna açılacaksa
// bu helper'ı çağırır.
//
// UYGULAMA YERLERİ (müşteri koduna AÇIK): `inventory.service.ts findRollByBarcode` ·
// `shipping.service.ts scanIntoSack` · `search.service.ts resolveExact`.
//
// KALAN OKUTMA ÇAĞRILARI — envanter (2026-10-30, `normalizeScanCode(` gerçek çağrıları; bu dilimde
// DEĞİŞTİRİLMEDİ). Etiket: [İÇ] = iç kod zorunlu · [AÇILMALI] = müşteri koduna açılmalı (sonraki dilim).
//   inventory.service.ts:1513   buildRollWhere (liste araması)            [AÇILMALI] — top listesi süzgeci
//   inventory.service.ts:2868   getRelabelContext (yeniden etiket)        [AÇILMALI] — müşteri etiketiyle gelen top
//   workorder-timeline.service.ts:276  lookup (iz sür)                    [AÇILMALI] — izlenebilirlik araması
//   kartela-timeline.service.ts:71     kartelaEventsWhere                 [İÇ] — kartela, müşteri kodu taşımaz
//   tambur.service.ts:589       getByCardBarcode (Tambur girişi)          [İÇ] — kod Tambur çıkışında doğar (K13)
//   tambur.service.ts:1657      listRecentOutputRolls (çıkış araması)     [AÇILMALI] — çıkış topları kod taşır
//   tambur.service.ts:1727      getSwatchByBarcode                        [İÇ] — kartela
//   tambur.service.ts:1769-1770 listSwatches (barcode · cardNumber)       [İÇ] — kartela
//   tambur.service.ts:1874-1875 getSwatchStats (barcode · cardNumber)     [İÇ] — kartela
//   tambur.service.ts:3959      getTamburContext (Tambur girişi)          [İÇ] — kod Tambur çıkışında doğar (K13)
//   traveler-card.service.ts:616  scan (refakat kartı)                    [İÇ] — kart kodu = iş emri no
//   traveler-card.service.ts:742  list (kart araması)                     [İÇ] — kart kodu
//   traveler-card.service.ts:817  findByBarcode (refakat kartı)           [İÇ] — kart kodu
//   kursun-bypass.service.ts:1801 completeFromTambur                       [İÇ] — Tambur öncesi; kod yok
//   sack-search.service.ts:1375   locateRoll (top nerede)                 [AÇILMALI] — sevk öncesi top bulma
//   return.service.ts:129         lookupForReturn (iade okutma)           [AÇILMALI] — müşteri kendi barkoduyla iade eder
//   return.service.ts:254         lookupSackForReturn (çuval)             [İÇ] — çuval kodu
//   kursun-qc.service.ts:321      getByCardBarcode (kurşun)               [İÇ] — Tambur öncesi; kod yok
//   tambur-manual.service.ts:308  resolveRoll (elle Tambur girişi)        [İÇ] — kod Tambur çıkışında doğar
//   helpers/return-scope.helper.ts:114 lookupShipmentForReturn            [İÇ] — sevk belge no
//   reports/batch-trace.report.service.ts:108 searchBatches               [AÇILMALI] — parti izi araması
//   helpers/series-classifier.helper.ts:99 classifyScannedCode            — sınıflandırıcının kendisi
// =============================================================================

import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { normalizeScanCode } from "../../utils/code-format";
import { readScanCustomerCodeLookupEnabled } from "../system-setting.service";

export type ScanMatchedBy = "BARCODE" | "CUSTOMER_CODE";

export interface CustomerCodeCandidate {
  rollId: string;
  barcode: string | null;
  customerId: string;
  customerName: string;
  code: string;
}

export type RollScanResolution<T> =
  | { kind: "FOUND"; roll: T; matchedBy: ScanMatchedBy; customerCode: string | null }
  | { kind: "NONE"; code: string }
  | { kind: "AMBIGUOUS"; code: string; candidates: CustomerCodeCandidate[] };

export interface ResolveRollByScanOptions<T> {
  /** Çağıranın BUGÜNKÜ top okuması (select/include onundur) — iç barkodda `{ barcode }`, müşteri kodunda `{ id }` ile çağrılır. */
  load: (where: Prisma.RollWhereUniqueInput) => Promise<T | null>;
  /** Önceden okunmuş ayar (çağıran zaten okuduysa ikinci sorgu olmasın). */
  lookupEnabled?: boolean;
  /** Topun DIŞINDAKİ iç kod tabloları (ör. kartela) — iç kod müşteri kodundan önce gelir; true → NONE (çağıran kendi yolunu yürür). */
  otherInternalHit?: (code: string) => Promise<boolean>;
}

/** Belirsizlikte aday listesi en çok bu kadar döner (okutma yüzeyi modal açar). */
const MAX_CANDIDATES = 10;

export async function resolveRollByScanCode<T>(rawCode: string, opts: ResolveRollByScanOptions<T>): Promise<RollScanResolution<T>> {
  const code = normalizeScanCode(rawCode);
  const internal = await opts.load({ barcode: code });
  if (internal) return { kind: "FOUND", roll: internal, matchedBy: "BARCODE", customerCode: null };
  if (code === "") return { kind: "NONE", code };
  const enabled = opts.lookupEnabled ?? (await readScanCustomerCodeLookupEnabled());
  if (!enabled) return { kind: "NONE", code };
  if (opts.otherInternalHit && (await opts.otherInternalHit(code))) return { kind: "NONE", code };

  const holders = await prisma.rollCustomerCode.findMany({
    where: { code, revokedAt: null },
    select: { rollId: true, customerId: true, code: true, roll: { select: { barcode: true } }, customer: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: MAX_CANDIDATES + 1,
  });
  if (holders.length === 0) return { kind: "NONE", code };
  if (holders.length > 1) {
    return {
      kind: "AMBIGUOUS",
      code,
      candidates: holders.slice(0, MAX_CANDIDATES).map((h) => ({
        rollId: h.rollId, barcode: h.roll.barcode, customerId: h.customerId, customerName: h.customer.name, code: h.code,
      })),
    };
  }
  const roll = await opts.load({ id: holders[0]!.rollId });
  if (!roll) return { kind: "NONE", code };
  return { kind: "FOUND", roll, matchedBy: "CUSTOMER_CODE", customerCode: holders[0]!.code };
}

/** Belirsiz müşteri kodunu fail-closed 409'a çevirir (adaylarla; istemci seçim modalı açar). */
export function ambiguousCustomerCodeError(r: { code: string; candidates: CustomerCodeCandidate[] }): AppError {
  return AppError.conflict(
    `"${r.code}" kodu birden çok müşteride kayıtlı — hangi top olduğunu seçin ya da top barkodunu okutun.`,
    { code: "CUSTOMER_CODE_AMBIGUOUS", scannedCode: r.code, candidates: r.candidates },
  );
}

/** Yanıta eklenen eşleşme alanları — YALNIZ müşteri kodu eşleşmesinde (yokluğu = iç barkod; bugünkü yanıt bayt-aynı). */
export function matchExtras(r: { matchedBy: ScanMatchedBy; customerCode: string | null }): { matchedBy?: "CUSTOMER_CODE"; customerCode?: string } {
  return r.matchedBy === "CUSTOMER_CODE" && r.customerCode ? { matchedBy: "CUSTOMER_CODE", customerCode: r.customerCode } : {};
}
