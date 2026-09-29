// =============================================================================
// BEKÇİ — İSTEMCİ SÜRÜM POLİTİKASI KİRADAN (3d-2)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_client_policy_kira.ts   (DB GEREKMEZ)
//
// NE ÖLÇER: `currentVersion` kodda bayat kalıyordu (1.2.6/1.0.5); artık kanalın güncel sürümü
// satıcının İMZALI kirasından (`kanal.guncelSurumler.panel/tablet`) gelir. `minVersion` KODDA kalır
// (kırılma kararı deploy'la değişir). Kira yoksa ya da alan taşımıyorsa BUGÜNKÜ davranış (kod değeri).
// Uç (`GET /api/client-policy[/:istemci]`) aynı çözücüden okur — kod değerine sapan uç kırmızı.
//
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı): N1 tekil uç yeniden
// `CLIENT_VERSION_POLICIES`ten okudu → §4a kırmızı · N2 çözücü kira anahtarını `backend`e eşledi → §2a/§2b kırmızı.
// =============================================================================
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { createPublicKey, randomUUID } from "node:crypto";
import express from "express";
import { AuditService } from "../src/services/audit.service";
import { loadLicenseStoreSync } from "../src/lib/license/store";
import { configureLicenseRuntimeForTests, setLicenseDbFacts, setMeasuredFingerprint } from "../src/lib/license/runtime";
import type { Fingerprint } from "../src/lib/license/protocol";
import { acceptLicenseResponse } from "../src/services/license-sync.service";
import { ELECTRON_VERSION_POLICY, MOBIL_VERSION_POLICY, WEB_VERSION_POLICY } from "../src/config/client-version-policy";
import { effectiveClientPolicies, effectiveClientPolicy } from "../src/lib/client-policy-lease";
import clientPolicyRoutes from "../src/routes/client-policy.routes";
import { fiksturKur, hakBas, kiraBas, type Fikstur } from "./lib/lisans-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

AuditService.logEvent = async () => undefined;
const KOK = fs.mkdtempSync(path.join(os.tmpdir(), "surum-politika-kira-"));

function kur(): Fikstur {
  const key = loadLicenseStoreSync({ dir: path.join(KOK, "lisans") }).key;
  if (!key) throw new Error("depo anahtarı yok");
  const f0 = fiksturKur(Date.now());
  const f: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: null });
  setLicenseDbFacts({ installationId: randomUUID(), firstOpenMs: Date.now() - 86_400_000, ledgerHighWaterMs: null });
  setMeasuredFingerprint({ digest: f.parmakIzi as Fingerprint, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date().toISOString() });
  return f;
}

async function kiraVer(f: Fikstur, guncelSurumler: Record<string, string>, verilisOfsetMs: number): Promise<void> {
  const verilis = new Date(Date.now() + verilisOfsetMs).toISOString();
  const kira = kiraBas(f, { zorlama: false, verilis, kiraId: randomUUID(), kanal: { kod: "deneme-kanal", guncelSurumler } });
  await acceptLicenseResponse({ v: 1, hak: hakBas(f), kira, indirmeBelirtecleri: [], sunucuSaati: new Date().toISOString(), kurulumId: f.kurulumId }, "cevrimdisi");
}

async function ucOku(yol: string): Promise<Record<string, unknown>> {
  const app = express();
  app.use("/api/client-policy", clientPolicyRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/client-policy${yol}`);
    return ((await res.json()) as { data: Record<string, unknown> }).data;
  } finally {
    server.close();
  }
}

async function main(): Promise<void> {
  try {
    console.log("§1 — kira yokken bugünkü davranış");
    const f = kur();
    check("§1a electron currentVersion = kod değeri", effectiveClientPolicy("electron")?.currentVersion === ELECTRON_VERSION_POLICY.currentVersion);
    check("§1b mobil currentVersion = kod değeri", effectiveClientPolicy("mobil")?.currentVersion === MOBIL_VERSION_POLICY.currentVersion);
    check("§1c tanımsız istemci yine YOK (404 yolu)", effectiveClientPolicy("yazici") === undefined);

    console.log("\n§2 — kira kanalın güncel sürümünü taşıyor");
    await kiraVer(f, { backend: "2.11.2", panel: "1.3.9", tablet: "1.0.12" }, -60_000);
    check("§2a ⭐ electron currentVersion = kira.panel", effectiveClientPolicy("electron")?.currentVersion === "1.3.9", effectiveClientPolicy("electron")?.currentVersion);
    check("§2b ⭐ mobil currentVersion = kira.tablet", effectiveClientPolicy("mobil")?.currentVersion === "1.0.12", effectiveClientPolicy("mobil")?.currentVersion);
    check("§2c minVersion KODDA kalır", effectiveClientPolicy("electron")?.minVersion === ELECTRON_VERSION_POLICY.minVersion && effectiveClientPolicy("mobil")?.minVersion === MOBIL_VERSION_POLICY.minVersion);
    check("§2d web ekseni kiradan etkilenmez", effectiveClientPolicy("web")?.currentVersion === WEB_VERSION_POLICY.currentVersion);
    check("§2e kod sabiti DEĞİŞMEDİ (üzerine yazılmadı)", ELECTRON_VERSION_POLICY.currentVersion !== "1.3.9");
    check("§2f künye aynı çözücüden", effectiveClientPolicies().electron?.currentVersion === "1.3.9");

    console.log("\n§3 — kira alanı taşımıyorsa kod değeri");
    await kiraVer(f, { backend: "2.11.3" }, 0);
    check("§3a ⭐ panel alanı yok → kod değeri", effectiveClientPolicy("electron")?.currentVersion === ELECTRON_VERSION_POLICY.currentVersion);

    console.log("\n§4 — uç çözücüden okur");
    await kiraVer(f, { panel: "1.4.0", tablet: "1.0.13" }, 60_000);
    const tekil = await ucOku("/electron");
    check("§4a ⭐ GET /api/client-policy/electron currentVersion = kira", tekil.currentVersion === "1.4.0", String(tekil.currentVersion));
    const kunye = await ucOku("");
    const clients = kunye.clients as Record<string, { currentVersion: string }>;
    check("§4b ⭐ GET /api/client-policy künyesi = kira", clients.mobil?.currentVersion === "1.0.13", clients.mobil?.currentVersion);
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata — ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    fs.rmSync(KOK, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
