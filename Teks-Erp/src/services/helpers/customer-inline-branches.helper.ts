// =============================================================================
// MÜŞTERİ CREATE — İÇ-İÇE (INLINE) ŞUBE DOĞRULAMA + ŞEKİLLENDİRME
// =============================================================================
// `customer.service.ts`ten taşındı (2026-09-17, dosya boyut tavanı): davranış bayt-bayt aynı.
// Müşteri + sevk noktaları TEK istekte, TEK transaction'da doğar (Prisma nested-create; order+lines emsali).
// =============================================================================
import { AppError } from "../../utils/app-error";
import { foldNameForCompare } from "./name-normalize.helper";
import { foldCodeForCompare } from "../../utils/code-format";
import type { ShipmentDestination } from "@prisma/client";
import { parseDestinationInput } from "./shipment-destination.helper";

/** Tek create'te izin verilen azami inline şube sayısı (kötüye kullanım seddi). */
const MAX_INLINE_BRANCHES = 50;

/** Prisma nested-create'e verilecek beyaz-listeli CustomerBranch skaler şekli. */
interface InlineBranchData {
  code: string | null;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  defaultDestination: ShipmentDestination | null;
}

/** Opsiyonel string alanı: boş/whitespace → null, uzunluk aşımı → 400 (1-tabanlı satır no'lu). */
function optBranchStr(raw: unknown, label: string, max: number, idx: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw AppError.badRequest(`${idx + 1}. şube: ${label} metin olmalı`);
  }
  const t = raw.trim();
  if (t === "") return null;
  if (t.length > max) {
    throw AppError.badRequest(`${idx + 1}. şube: ${label} en fazla ${max} karakter olabilir`);
  }
  return t;
}

/**
 * Müşteri create body'sindeki opsiyonel `branches` alanını doğrular + şekillendirir:
 *   - yok/null/boş dizi → undefined (nested-create hiç gönderilmez);
 *   - dizi değilse veya bir satır bozuksa → 400 (Türkçe, 1-tabanlı satır no'lu);
 *   - her satır CustomerBranch skaler alanlarına indirgenir (MASS-ASSIGNMENT YOK —
 *     yalnız beyaz-listeli alanlar geçer; `customerId` ilişkiden gelir, `id`/tarih
 *     sistem alanları asla istemciden yazılmaz).
 * Sınırlar customer-branch.routes.ts createSchema ile birebir (tek-adım / iki-adım
 * şube ekleme aynı validasyonu görsün).
 */
export function validateAndShapeBranches(raw: unknown): InlineBranchData[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw AppError.badRequest("Şubeler geçersiz (dizi bekleniyor)");
  }
  if (raw.length === 0) return undefined;
  if (raw.length > MAX_INLINE_BRANCHES) {
    throw AppError.badRequest(`Tek seferde en fazla ${MAX_INLINE_BRANCHES} şube eklenebilir`);
  }
  // Dizi içi ad + kod mükerrer kontrolü (Türkçe-duyarsız) — yeni müşteri
  // olduğundan mevcut şube yok; iki-adım yolun guard'ı customer-branch.service'te.
  const seenNames = new Map<string, number>();
  const seenCodes = new Map<string, number>();
  const shaped = raw.map((entry, idx): InlineBranchData => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw AppError.badRequest(`${idx + 1}. şube: geçersiz kayıt`);
    }
    const rec = entry as Record<string, unknown>;
    if (typeof rec.name !== "string" || rec.name.trim() === "") {
      throw AppError.badRequest(`${idx + 1}. şube: Şube adı zorunlu`);
    }
    const name = rec.name.trim();
    // Sınırlar DB kolonlarıyla birebir (CustomerBranch.name VARCHAR(100) /
    // code VARCHAR(50)) — aşan girdi Postgres P2000 (jenerik 400) yerine
    // burada net, alan-adlı Türkçe 400 alsın; ayrıca atomik create'i boşa düşürmesin.
    if (name.length > 100) {
      throw AppError.badRequest(`${idx + 1}. şube: Şube adı en fazla 100 karakter olabilir`);
    }
    const nameKey = foldNameForCompare(name);
    const firstIdx = seenNames.get(nameKey);
    if (firstIdx !== undefined) {
      throw AppError.badRequest(
        `${idx + 1}. şube: '${name}' adı ${firstIdx + 1}. şubeyle aynı — şube adları tekrar edemez`,
      );
    }
    seenNames.set(nameKey, idx);
    const code = optBranchStr(rec.code, "İhracat kodu", 50, idx);
    if (code) {
      // §18: KOD katlaması yerel-BAĞIMSIZ olmalı — `foldNameForCompare` (tr-TR
      // BÜYÜK) `i → İ` çevirdiği için "sip"/"SIP" çifti sessizce eşleşmezdi.
      const codeKey = foldCodeForCompare(code);
      const firstCodeIdx = seenCodes.get(codeKey);
      if (firstCodeIdx !== undefined) {
        throw AppError.badRequest(
          `${idx + 1}. şube: '${code}' ihracat kodu ${firstCodeIdx + 1}. şubeyle aynı — şube ihracat kodları tekrar edemez`,
        );
      }
      seenCodes.set(codeKey, idx);
    }
    return {
      code,
      name,
      address: optBranchStr(rec.address, "Adres", 500, idx),
      city: optBranchStr(rec.city, "Şehir", 80, idx),
      district: optBranchStr(rec.district, "İlçe", 80, idx),
      contactName: optBranchStr(rec.contactName, "İletişim kişisi", 120, idx),
      contactPhone: optBranchStr(rec.contactPhone, "Telefon", 40, idx),
      notes: optBranchStr(rec.notes, "Notlar", 500, idx),
      isActive: rec.isActive === undefined ? true : Boolean(rec.isActive),
      defaultDestination: parseDestinationInput(rec.defaultDestination, `${idx + 1}. şube: sevk yönü`) ?? null,
    };
  });
  return shaped;
}

