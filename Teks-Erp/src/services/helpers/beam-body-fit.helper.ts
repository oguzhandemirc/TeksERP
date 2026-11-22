// =============================================================================
// GÖVDE ENİ ↔ ÇÖZGÜ ENİ UYARISI — tek cevaplayıcı (devere/levent S9)
// =============================================================================
// Soru: "çözgü kartının tarak eni (`WarpSpec.reedWidthCm`) gövdenin eninden (`BeamBody.widthCm`) büyük mü?"
// Kabul (fason dönüş), içeride sarım ve takma aynı fonksiyonu çağırır. Yalnız BİLGİ uyarısı: kayıt engellenmez;
// iki enden biri eksikse sessizdir (veri girilmemiş kurulumda yanıt bayt-aynı). Gövdesiz çağrıda sorgu atılmaz.
// =============================================================================
import type { Prisma } from "@prisma/client";
import type prisma from "../../lib/prisma";
import { qtyText } from "./qty-text.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Bir gövde yoklaması: `widthCm` verilmezse (`undefined`) `beamBodyId`den okunur; yerinde tanımda eni çağıran verir. */
export interface BeamBodyWidthProbe {
  /** Uyarı başı ("2. levent: " gibi); boş olabilir. */
  label: string;
  beamBodyId?: string | null;
  bodyNo?: string | null;
  widthCm?: Prisma.Decimal | null;
}

/** Saf karar: tarak eni gövde eninden büyükse uyarı metni, değilse ya da veri eksikse null. */
export function beamBodyWidthWarning(
  spec: { code: string; reedWidthCm: Prisma.Decimal | null },
  body: { label: string; bodyNo: string | null; widthCm: Prisma.Decimal | null },
): string | null {
  if (spec.reedWidthCm == null || body.widthCm == null || !spec.reedWidthCm.gt(body.widthCm)) return null;
  return `${body.label}${body.bodyNo ?? "Gövde"} eni ${qtyText(body.widthCm)} cm, çözgü kartı ${spec.code} tarak eni ${qtyText(spec.reedWidthCm)} cm — çözgü gövdeye sığmayabilir (bilgi; kayıt engellenmedi).`;
}

/** Çözgü kartı ↔ gövdeler: uyarı listesi (sırası yoklama sırası). Kart ya da gövde eni yoksa boş. */
export async function beamBodyWidthWarningsTx(db: Db, warpSpecId: string, probes: BeamBodyWidthProbe[]): Promise<string[]> {
  if (probes.length === 0) return [];
  const spec = await db.warpSpec.findUnique({ where: { id: warpSpecId }, select: { code: true, reedWidthCm: true } });
  if (!spec?.reedWidthCm) return [];
  const out: string[] = [];
  for (const p of probes) {
    let { bodyNo = null, widthCm } = p;
    if (widthCm === undefined) {
      if (!p.beamBodyId) continue;
      const b = await db.beamBody.findUnique({ where: { id: p.beamBodyId }, select: { bodyNo: true, widthCm: true } });
      bodyNo = b?.bodyNo ?? bodyNo;
      widthCm = b?.widthCm ?? null;
    }
    const w = beamBodyWidthWarning(spec, { label: p.label, bodyNo, widthCm });
    if (w) out.push(w);
  }
  return out;
}
