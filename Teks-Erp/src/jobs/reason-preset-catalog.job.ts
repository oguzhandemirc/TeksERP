// =============================================================================
// Hazır sebep kataloğu — boot-time uzlaştırma (2026-08-19)
// =============================================================================
// `permission-catalog.job.ts` / `role-template-catalog.job.ts` ile AYNI kalıp ve
// aynı gerekçe: satırlar yalnız `seed.ts`'te yaşasaydı, seed yalnız ilk kurulumda
// koştuğu için MEVCUT fabrikada tablo BOŞ doğardı — ve boş katalog, sebebi
// zorunlu olan fire kararında operatörü kilitlerdi.
//
// SÖZLEŞME — YALNIZ EKLE:
//   • Kodu DB'de olmayan sistem satırı OLUŞTURULUR.
//   • Var olan satırın ETİKETİ/SIRASI/GÖRÜNÜRLÜĞÜ EZİLMEZ — fabrika düzenlemiş
//     ya da gizlemiş olabilir ve bizim varsayılanımız onu geri getirmemeli.
//   • Fabrikanın kendi eklediği satırlara DOKUNULMAZ.
//   • `requiresText` de ezilmez (fabrika "Diğer"i kapatmış olabilir).
//
// ⚠️ `isSystem` bayrağı satırın SİLİNEMEZ olduğunu söyler; sert silme bir sonraki
// `pm2 restart`'ta DİRİLİŞ demekti (rol şablonlarında birebir yaşandı). Silmek
// yerine gizlenir.
//
// BEST-EFFORT: hata sunucuyu DÜŞÜRMEZ ama sessizce de yutulmaz.
// =============================================================================

import { ReasonPresetKind } from "@prisma/client";

import prisma from "../lib/prisma";
import { REASON_PRESET_CATALOG, REASON_PRESET_KINDS, KIND_STORES_TEXT } from "../constants/reason-presets";
import { refreshReasonPresetCache } from "../services/reason-preset.service";
import { bilgi, hata } from "../lib/logger";

export type ReasonPresetReconcileResult = {
  total: number;
  created: string[];
  existing: number;
  /** Fabrikanın kendi eklediği satır sayısı — DOKUNULMADI. */
  custom: number;
};

export async function reconcileReasonPresets(): Promise<ReasonPresetReconcileResult> {
  const result: ReasonPresetReconcileResult = { total: 0, created: [], existing: 0, custom: 0 };

  const rows = await prisma.reasonPreset.findMany({ select: { kind: true, code: true, isSystem: true, sortOrder: true } });
  const have = new Set(rows.map((r) => `${r.kind}:${r.code}`));
  result.custom = rows.filter((r) => !r.isSystem).length;

  for (const kind of REASON_PRESET_KINDS) {
    const seeds = REASON_PRESET_CATALOG[kind];
    result.total += seeds.length;
    // Yeni sistem satırı, mevcut listenin ARDINA eklenir — fabrikanın kurduğu
    // sırayı bozmamak için (bizim dizi sırası yalnız İLK kurulumda geçerli).
    let nextOrder = Math.max(-1, ...rows.filter((r) => r.kind === kind).map((r) => r.sortOrder)) + 1;
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i]!;
      if (have.has(`${kind}:${seed.code}`)) {
        result.existing++;
        continue;
      }
      const isFirstInstall = rows.filter((r) => r.kind === kind).length === 0;
      await prisma.reasonPreset.create({
        data: {
          kind: kind as ReasonPresetKind,
          code: seed.code,
          label: seed.label,
          fullText: KIND_STORES_TEXT[kind] ? (seed.fullText ?? seed.label) : null,
          requiresText: seed.requiresText ?? false,
          sortOrder: isFirstInstall ? i : nextOrder++,
          isSystem: true,
        },
      });
      result.created.push(`${kind}:${seed.code}`);
    }
  }

  await refreshReasonPresetCache();
  return result;
}

/** `server.ts` çağırır — hata sunucuyu düşürmez. */
export async function runReasonPresetReconciliation(): Promise<void> {
  try {
    const r = await reconcileReasonPresets();
    if (r.created.length > 0) {
      bilgi("reason-presets", `${r.created.length} yeni sistem sebebi eklendi: ${r.created.join(", ")}`);
    } else {
      bilgi("reason-presets", `katalog güncel (${r.existing} sistem + ${r.custom} fabrika satırı)`);
    }
  } catch (err) {
    hata("reason-presets", "uzlaştırma başarısız:", err);
  }
}
