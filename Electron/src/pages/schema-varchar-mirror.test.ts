// =============================================================================
// BEKÇİ — panel zod `max(n)` ↔ Prisma `@db.VarChar(n)` AYNASI
// =============================================================================
// Master-data CRUD'da doğrulamayı yapan TEK kapı paneldir: backend
// `BaseController` gövdeyi Zod'suz doğrudan servise geçirir
// (`Teks-Erp/src/controllers/base.controller.ts`). Panel sınırı DB kolonundan
// GENİŞSE aradaki uzunluk sessizce geçer ve kullanıcı net bir Türkçe 400
// yerine Prisma P2000 alır (ELECTRON.md [EL-25]).
//
// Eşleme MEKANİK DEĞİLDİR (panel alanı ↔ Prisma kolonu ad benzerliğinden
// çıkarılamaz: `Customers/schema.ts` içindeki `code` alanının aynası
// `Customer.code` değil `CustomerBranch.code`'dur). Bu yüzden çiftler AŞAĞIDA
// ELLE beyan edilir; bekçi yalnız beyan edilen çiftin iki ucunu ölçer.
//
// Yeni master-data alanı eklerken buraya bir satır ekle.
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PRISMA = resolve(__dirname, "../../../Teks-Erp/prisma/schema.prisma");

interface Ciftt {
  /** `src/pages/` altındaki şema dosyası. */
  dosya: string;
  /** zod alan adı (`ad: z.string()…max(n)`). */
  alan: string;
  /** Prisma modeli ve kolonu — aynanın DB ucu. */
  model: string;
  kolon: string;
  /**
   * Panel bilerek DB'den DAR ise gerekçesi. Dar taraf P2000 üretmez (güvenli
   * yön), ama beyansız bırakılırsa "eşit olmalıydı" ile "bilerek dar" ayırt
   * edilemez — beyan bunu görünür tutar.
   */
  darGerekce?: string;
}

const CIFTLER: Ciftt[] = [
  { dosya: "Customers/schema.ts", alan: "name", model: "Customer", kolon: "name" },
  { dosya: "DefectTypes/schema.ts", alan: "name", model: "DefectType", kolon: "name" },
  { dosya: "Machines/schema.ts", alan: "name", model: "Machine", kolon: "name" },
  { dosya: "Routes/schema.ts", alan: "name", model: "Route", kolon: "name" },
  { dosya: "Stations/schema.ts", alan: "name", model: "Station", kolon: "name" },
  { dosya: "Stations/schema.ts", alan: "department", model: "Station", kolon: "department" },
  { dosya: "Subcontractors/schema.ts", alan: "name", model: "Subcontractor", kolon: "name" },
  {
    dosya: "Colors/schema.ts",
    alan: "name",
    model: "Color",
    kolon: "name",
    darGerekce: "Renk adı etikete/rozete sığmalı — panel bilerek DB'den dar (80 < 100).",
  },
  { dosya: "Warehouses/schema.ts", alan: "name", model: "Warehouse", kolon: "name" },
];

/** `model X { … kolon Tip @db.VarChar(n) … }` → n (yoksa null = sınırsız). */
function varcharLen(src: string, model: string, kolon: string): number | null {
  const blok = new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, "m").exec(src);
  if (!blok) return null;
  const satir = new RegExp(`^\\s*${kolon}\\s+\\w+\\??\\s.*$`, "m").exec(blok[1]!);
  if (!satir) return null;
  const v = /@db\.VarChar\((\d+)\)/.exec(satir[0]);
  return v ? Number(v[1]) : null;
}

/** İlk `alan: z.string()…max(n)` zincirindeki n. */
function zodMax(src: string, alan: string): number | null {
  const flat = src.replace(/\s+/g, " ");
  const m = new RegExp(
    `\\b${alan}\\s*:\\s*z\\s*\\.string\\(\\)((?:\\s*\\.\\w+\\([^()]*(?:\\([^()]*\\))?[^()]*\\))*)`,
  ).exec(flat);
  if (!m) return null;
  const mx = /\.max\(\s*(\d+)/.exec(m[1]!);
  return mx ? Number(mx[1]) : null;
}

describe("panel zod max(n) ↔ Prisma VarChar(n)", () => {
  it("zemin: Prisma şeması okunabildi", () => {
    // KÖRLÜK ZEMİNİ: şema dosyası taşınırsa "sapma yok" ile "hiçbir şeye
    // bakılmadı" aynı yeşile çıkardı.
    expect(existsSync(PRISMA), `${PRISMA} bulunamadı`).toBe(true);
    expect(readFileSync(PRISMA, "utf8").length).toBeGreaterThan(50_000);
    expect(CIFTLER.length).toBeGreaterThan(5);
  });

  it.each(CIFTLER)("$dosya · $alan ↔ $model.$kolon", (c) => {
    const prisma = readFileSync(PRISMA, "utf8");
    const panel = readFileSync(resolve(__dirname, c.dosya), "utf8");
    const db = varcharLen(prisma, c.model, c.kolon);
    const zod = zodMax(panel, c.alan);
    // İki uç da OKUNABİLMELİ — biri null ise beyan bayatlamıştır ve bekçi
    // sessizce kör kalırdı.
    expect(db, `${c.model}.${c.kolon} VarChar(n) okunamadı`).not.toBeNull();
    expect(zod, `${c.dosya} → ${c.alan} max(n) okunamadı`).not.toBeNull();
    // ASIL KAPI: panel DB'den GENİŞ olamaz — aradaki uzunluk formdan geçer ve
    // net Türkçe 400 yerine Prisma P2000 olur.
    expect(zod!, "panel sınırı DB kolonundan GENİŞ — P2000 riski").toBeLessThanOrEqual(db!);
    // Beyansız çiftte norm BİREBİRLİKTİR ([EL-25]); dar taraf yalnız gerekçeyle.
    if (!c.darGerekce) expect(zod, "beyansız çift birebir olmalı").toBe(db);
  });
});
