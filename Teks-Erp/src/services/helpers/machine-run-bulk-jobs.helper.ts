// =============================================================================
// Tezgah Salonu toplu iş ver — SATIR BAŞINA İŞ (tasarım TEZGAH-SALONU-SECIM-IS-VERME §C.6)
// =============================================================================
// Satırın işi TEK çözümleyiciden (`rowJobIdOf`): satır alanı verilmişse o (null = işsiz/numune),
// verilmemişse istek düzeyi — eski panel satır alanı göndermez, davranışı değişmez. Uygulama yolu
// işi `openMachineRun`e geçirir (kapılar orada, satır hatası `failed`e düşer); önizleme aynı kapıları
// farklı iş başına BİR kez sorar ve iş kuralı hatasını yalnız o işin satırlarına ENGEL yazar.
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { assertRunWeavingOrderGate, assertWeavingOrderLinkableTx, type LinkableWeavingOrder } from "./production-chain-gates.helper";

export interface RowJobInput {
  /** Tanımsız = istek düzeyindeki iş; null = işsiz (numune) koşum. */
  weavingOrderId?: string | null;
}

/** Satırın işi — önizleme ve uygulama AYNI çözümleyiciyi okur. */
export function rowJobIdOf(row: RowJobInput, requestJobId: string | null | undefined): string | null {
  return row.weavingOrderId !== undefined ? row.weavingOrderId : (requestJobId ?? null);
}

/** İstek düzeyindeki iş en az bir satırda kullanılıyor mu (yoksa istek düzeyi kapısı sorulmaz). */
export const usesRequestJob = (rows: readonly RowJobInput[]): boolean => rows.some((r) => r.weavingOrderId === undefined);

export type RowJobCheck = { order: LinkableWeavingOrder | null; block: { code: string; message: string } | null };

/** Satır işlerinin kapıları (iş zorunlu · bağlanabilir) — iş kuralı hatası satır engeli, başka hata YUTULMAZ. */
export async function checkRowJobs(jobIds: Iterable<string | null>): Promise<Map<string | null, RowJobCheck>> {
  const out = new Map<string | null, RowJobCheck>();
  for (const id of new Set(jobIds)) {
    try {
      await assertRunWeavingOrderGate(prisma, id);
      out.set(id, { order: id ? await assertWeavingOrderLinkableTx(prisma, id) : null, block: null });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      const code = String((e.details as { code?: unknown } | undefined)?.code ?? "") || `HTTP_${e.statusCode}`;
      out.set(id, { order: null, block: { code, message: e.message } });
    }
  }
  return out;
}
