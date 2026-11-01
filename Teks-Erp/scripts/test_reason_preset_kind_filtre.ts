// =============================================================================
// Test: HAZIR SEBEP LİSTESİ `kind` SÜZGECİ + ZARF SÖZLEŞMESİ (SY-F3K, 2026-11-01)
// =============================================================================
// Sunum provasında "`?kind=MACHINE_STOP` bütün türleri dönüyor" bulgusu: main'de süzgeç çalışıyor (HTTP
// ölçümü); panel ve tablet `kind` göndermeyip istemcide süzdüğü için ağ sekmesinde bütün türler görünür.
// Bu bekçi HTTP katmanında kilitler:
//   §1 `?kind=X` yalnız X türünü döner, servis sayımıyla aynı (aktif satırlar).
//   §2 ZARF: yanıt ZARFSIZ dizidir (`{ success, data }` değil) — tablet `r.data`yı dizi olarak okur;
//      zarf değişirse eski tablet sebep listesini boş görür.
//   §3 `kind` yoksa birden çok tür gelir (istemcinin bugünkü yolu); uydurma `kind` 400 (fail-closed).
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_reason_preset_kind_filtre.ts
// NEGATİF SONDA (2026-11-01): route `kind`'ı servise geçirmeyince §1a/§1b ❌ (4/2); yanıt `{ success, data }`
// zarfına sarılınca §2a/§2b dahil 1/5; ikisi de geri alındı (6/0).
// =============================================================================
import type { AddressInfo } from "node:net";
import { ReasonPresetKind } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

type Row = { kind: string; isActive: boolean };

async function main(): Promise<void> {
  const block = hedefDbEngeli();
  if (block) {
    console.log(`⛔ ${block}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== HAZIR SEBEP kind SÜZGECİ ===");
  const admin = await ensureTestAdmin();
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: admin.username, password: admin.password }),
    });
    const token = ((await login.json()) as { data?: { token?: string } }).data?.token;
    if (!token) throw new Error("login başarısız");
    const get = async (q: string): Promise<{ status: number; body: unknown }> => {
      const r = await fetch(`${base}/api/reason-presets${q}`, { headers: { Authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.json() };
    };

    const kind = ReasonPresetKind.MACHINE_STOP;
    const expected = await prisma.reasonPreset.count({ where: { kind, isActive: true } });
    const one = await get(`?kind=${kind}`);
    const rows = Array.isArray(one.body) ? (one.body as Row[]) : [];
    const kinds = [...new Set(rows.map((r) => r.kind))];
    check("§1a ?kind=MACHINE_STOP yalnız MACHINE_STOP döner", one.status === 200 && rows.length > 0 && kinds.length === 1 && kinds[0] === kind, `status=${one.status} kinds=${kinds.join(",")}`);
    check("§1b satır sayısı servisteki aktif MACHINE_STOP sayısı", rows.length === expected, `${rows.length}/${expected}`);
    check("§2a yanıt ZARFSIZ dizi (eski tablet r.data'yı dizi okur)", Array.isArray(one.body), typeof one.body);

    const all = await get("");
    const allRows = Array.isArray(all.body) ? (all.body as Row[]) : [];
    check("§2b kind'sız yanıt da zarfsız dizi", all.status === 200 && Array.isArray(all.body));
    check("§3a kind'sız liste birden çok tür taşır (istemci süzer)", new Set(allRows.map((r) => r.kind)).size > 1);
    check("§3b uydurma kind → 400", (await get("?kind=UYDURMA")).status === 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
