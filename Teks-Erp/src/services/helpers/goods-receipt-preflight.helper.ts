// =============================================================================
// MAL KABUL SATIRLARI ÖN-UÇUŞ — DOĞRULAMA SINIFI hata TEK SATIR YAZILMADAN reddedilir (kullanıcı bulgusu C8, 2026-09-17)
// =============================================================================
// Bulgu: `devere.lotRequired` açıkken lotsuz iplik satırı sunucuda `failed[]`e düşüyor, fiş BAŞLIĞI doğuyor, panel
// "1 satır atlandı" deyip modalı kapatıyordu → içi boş fiş. İki hata sınıfı ayrılır: ① DOĞRULAMA (lot zorunlu · bobin
// adedi · ürün yok/pasif/yanlış tür · miktar) — girdiden bilinir, satır döngüsünden ÖNCE hepsi toplanır, ilk ihlal
// listesiyle 400 `RECEIPT_LINES_INVALID` `details.lines[{lineNo, code, message}]`, fiş başlığı AÇILMAZ; ② KOŞU ANI
// (yarış/409, kilit, mükerrer barkod) — satır-satır tx ve `failed[]` kalır. Tek okuma: kalem bilgisi tek sorgu,
// `readDevereLotRequired` bir kez.
// =============================================================================
import { ItemType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { normalizeLotNo } from "./yarn-lot.helper";
import { readDevereLotRequired } from "../system-setting.service";

export interface PreflightLine {
  itemId: string;
  initialQty: number;
  lotNo?: string | null;
  bobbinCount?: number | null;
}

export interface ReceiptLineIssue {
  /** 1 tabanlı satır sırası — panel satırla eşler. */
  lineNo: number;
  code: "ITEM_NOT_FOUND" | "ITEM_INACTIVE" | "ITEM_TYPE_NOT_ALLOWED" | "QTY_INVALID" | "YARN_LOT_REQUIRED" | "BOBBIN_INVALID";
  message: string;
}

export const YARN_LOT_REQUIRED_MESSAGE = `İplik satırında lot numarası zorunlu (ayar: "Devere — lot zorunlu"). İrsaliyedeki lot numarasını olduğu gibi yazın.`;

/** Doğrulama sınıfı ihlalleri toplar (boş dizi = geçti). Sıra: satır sırası. */
export async function collectReceiptLineIssues(lines: PreflightLine[]): Promise<ReceiptLineIssue[]> {
  if (lines.length === 0) return [];
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const rows = await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, itemType: true, isActive: true, name: true } });
  const info = new Map(rows.map((r) => [r.id, r]));
  const hasYarn = lines.some((l) => info.get(l.itemId)?.itemType === ItemType.YARN);
  const lotRequired = hasYarn ? await readDevereLotRequired() : false;
  const issues: ReceiptLineIssue[] = [];
  lines.forEach((l, i) => {
    const lineNo = i + 1;
    const it = info.get(l.itemId);
    if (!it) return issues.push({ lineNo, code: "ITEM_NOT_FOUND", message: "Ürün bulunamadı." });
    if (!it.isActive) return issues.push({ lineNo, code: "ITEM_INACTIVE", message: `"${it.name}" pasif (silinmiş) — fişe alınamaz.` });
    if (it.itemType === ItemType.CONSUMABLE) return issues.push({ lineNo, code: "ITEM_TYPE_NOT_ALLOWED", message: `"${it.name}" sarf malzeme — mal kabul fişi yalnız kumaş ve iplik alır.` });
    if (!(Number(l.initialQty) > 0)) return issues.push({ lineNo, code: "QTY_INVALID", message: "Miktar sıfırdan büyük olmalı." });
    if (it.itemType === ItemType.YARN) {
      if (lotRequired && !normalizeLotNo(l.lotNo)) return issues.push({ lineNo, code: "YARN_LOT_REQUIRED", message: YARN_LOT_REQUIRED_MESSAGE });
      if (l.bobbinCount != null && (!Number.isInteger(l.bobbinCount) || l.bobbinCount <= 0)) return issues.push({ lineNo, code: "BOBBIN_INVALID", message: "Bobin adedi pozitif tam sayı olmalı." });
    }
    return undefined;
  });
  return issues;
}

/** İhlal varsa 400 `RECEIPT_LINES_INVALID` — fiş başlığı açılmadan. */
export async function assertReceiptLinesValid(lines: PreflightLine[]): Promise<void> {
  const issues = await collectReceiptLineIssues(lines);
  if (issues.length === 0) return;
  const first = issues[0]!;
  throw AppError.badRequest(`${issues.length} satır kaydedilemez — ${first.lineNo}. satır: ${first.message}`, { code: "RECEIPT_LINES_INVALID", lines: issues });
}
