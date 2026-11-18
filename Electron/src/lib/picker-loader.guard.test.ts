import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PICKER_MAX_PAGE_SIZE } from "./picker-loader";

/**
 * PICKER VERİ ÇEKME KURALININ MEKANİK BEKÇİSİ.
 *
 * `Electron/CLAUDE.md` "Picker / Dropdown Veri Çekme Kuralı" bölümü bunu 2026'dan
 * beri yazıyor ve fiilen UYGULANMIYORDU: denetimde 21 inline `pageSize: 200|500`
 * çağrısı bulundu — tam da kuralın "✗ YANLIŞ" dediği şey. Yazılı bir kural,
 * kimse bakmadığında kural değildir.
 *
 * ARIZANIN GÖRÜNÜMÜ: backend `MAX_PAGE_SIZE` değiştiğinde inline çağrı 400 alır
 * (100 → 200 → 500 geçişlerinde defalarca yaşandı); daha sinsisi, liste sınırı
 * AŞTIĞINDA `loadAllForPicker` HATA fırlatırken inline çağrı sessizce KESİLMİŞ
 * veri döndürür — operatör kumaşı listede bulamaz ve "sistemde yok" sanır.
 * Kumaş bugün 194/500.
 *
 * ⚠️ İSTİSNA LİSTESİ YOK ve bilinçli: bugün ihlal SIFIR. Meşru bir sebep
 * doğarsa (ör. picker olmayan bir toplu okuma) buraya gerekçeli bir muaf
 * eklenir — ama muaf listesi boş başlamalı, yoksa "zaten dolu" diye büyür.
 */

const SRC = resolve(__dirname, "..");
const INLINE_PAGE_SIZE = /pageSize:\s*(\d{3,})/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Yorum satırlarını at — kuralın KENDİSİNİ anlatan metinler eşleşmesin. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const FILES = walk(SRC);
/**
 * Gerekçeli muaflar. Kural "her üç haneli pageSize yanlıştır" DEMEZ — kural
 * "TÜMÜNÜ ÇEK davranışı tek kaynaktan geçsin" der. Aşağıdakiler o davranış
 * DEĞİL, o yüzden muaf. Muaf listesi bayatlığa karşı da denetleniyor (§3):
 * dosya artık ihlal içermiyorsa test düşer — ölü muaf, gerçek bir ihlali
 * sessizce kapsam dışında tutar.
 */
const ALLOWED: Record<string, string> = {
  "lib/picker-loader.ts": "helper'ın kendisi — sınırı O tanımlıyor",
  "pages/Operations/Rolls/useRollStats.ts":
    "picker DEĞİL: liste sayfasının URL parametrelerine varsayılan sayfa boyutu veriyor",
  // ── Depo/Muhasebe LİSTE SAYFALARI (2026-09-01, birleştirme) ───────────────
  // Bunlarda 100/200 bir "tümünü çek" TAVANI DEĞİL, arama sonucunun SAYFA
  // BOYUTUdur (`OrderPickerDialog` ile aynı sınıf): sunucu araması + filtre var,
  // `loadAllForPicker`a çevirmek aramayı KALDIRIR ve tüm defteri istemciye çeker.
  // ⚠️ Ayrı ve BİLİNEN sınır: bu sayfalarda sayfalama YOK — kayıt 100'ü aşarsa
  // fazlası GÖRÜNMEZ. Kural ihlali değil, ayrı bir iş (takip).
  "pages/Finance/CariPage.tsx": "arama tabanlı cari listesi — 100 sayfa boyutu",
  "pages/Finance/InvoicesPage.tsx": "arama tabanlı fatura listesi — 100 sayfa boyutu",
  "pages/Finance/Allocations/service.ts":
    "tahsis edilebilir çek arama sonucu — 200 sayfa boyutu, picker değil",
  "pages/Operations/GoodsReceipts/GoodsReceiptsPage.tsx":
    "arama tabanlı mal kabul listesi — 100 sayfa boyutu",
  "pages/Operations/WarehouseTransfers/WarehouseTransfersPage.tsx":
    "transfer listesi — 100 sayfa boyutu",
  "pages/Operations/WarehouseTransfers/service.ts":
    "BARKOD çözümü: okutulan barkodun aday kümesi (statü süzgeçli), picker değil",
  "pages/Operations/WorkOrders/OrderPickerDialog.tsx":
    "ARAMA tabanlı picker (debounce'lu sunucu araması + filtre + özel uç). " +
    "Orada 100 bir 'tümünü çek' tavanı değil, sonuç sayfası boyutudur — " +
    "`loadAllForPicker`a çevirmek aramayı KALDIRIRDI",
};

describe("picker veri çekme kuralı", () => {
  // KÖRLÜK ZEMİNİ: tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakmadım"
  // AYNI YEŞİLE çıkar.
  it("zemin: kaynak ağacı tarandı", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(PICKER_MAX_PAGE_SIZE).toBeGreaterThanOrEqual(500);
  });

  it("inline üç haneli pageSize YOK — hepsi loadAllForPicker'dan geçiyor", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      const rel = relative(SRC, file);
      if (ALLOWED[rel]) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      for (const m of src.matchAll(INLINE_PAGE_SIZE)) {
        const size = Number(m[1]);
        if (size < 100) continue;
        const line = src.slice(0, m.index).split("\n").length;
        violations.push(`${rel}:${line} → pageSize: ${size}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("muaf listesi bayat değil (her muaf gerçekten ihlal içeriyor)", () => {
    const stale: string[] = [];
    for (const rel of Object.keys(ALLOWED)) {
      if (rel === "lib/picker-loader.ts") continue; // sınırı tanımlayan dosya
      const src = stripComments(readFileSync(join(SRC, rel), "utf8"));
      if (![...src.matchAll(INLINE_PAGE_SIZE)].some((m) => Number(m[1]) >= 100)) {
        stale.push(rel);
      }
    }
    expect(stale, `artık ihlal içermiyor — muaftan çıkar: ${stale.join(", ")}`).toEqual([]);
  });

  it("loadAllForPicker gerçekten kullanılıyor (kural ölü harf değil)", () => {
    const users = FILES.filter((f) =>
      readFileSync(f, "utf8").includes("loadAllForPicker("),
    );
    expect(users.length).toBeGreaterThan(15);
  });
});
