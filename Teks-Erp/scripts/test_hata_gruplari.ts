// =============================================================================
// HATA GRUBU KÜMESİ — rapor v2 "hata grubu" boyutu (R1-BOYUT).
// Küme YALNIZ `src/constants/hata-gruplari.ts`te yazılır; `defect_types."defectGroup"` CHECK'siz.
// §1 küme + Türkçe ad · §2 duruş eşlemesinin hedefleri kümede · §3 İKİ YÖNLÜ: her `MACHINE_STOP_REASONS`
// kodu eşlemede beyanlı (grup ya da bilinçli null), eşlemede olmayan kod yok · §4 gövde doğrulaması
// (bilinmeyen 400 `INVALID_DEFECT_GROUP`, "" → null, alan yoksa dokunma) · §5 route iki yazma yolunda
// doğrular · §6 ikinci liste YOK (src'de grup literal'i yalnız iki dosyada) · §7 panel aynası BAYT-EŞİT
// + import'suz · §8 genel CRUD kapısı AÇIK (write-guard) · §9 DB gidiş-dönüş (DATABASE_URL varsa).
// ✓B5 (bu commit) — R1-BOYUT 2026-10-24, hepsi md5 ile birebir geri alındı (20/0'a döndü):
//   ① eşlemeden `COZGU_KOPUSU` satırı silindi → ❌ 3 (§3a, §3c, §7b ayna kaydı)
//   ② helper'a ikinci liste `["COZGU","ATKI",…]` yazıldı → ❌ 1 (§6)
//   ③ route'tan `normalizeDefectGroupBody` çağrısı silindi → ❌ 1 (§5)
//   ④ write-guard'a `defectType: ["defectGroup"]` geri kondu → ❌ 2 (§8, §9a gövde sessizce düştü)
//   ⑤ helper'da küme denetimi `false &&` ile devre dışı → ❌ 1 (§4d)
// Koşum: npx tsx scripts/test_hata_gruplari.ts   (§9 için test DB; diğerleri DB'siz)
// =============================================================================
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  DEFECT_GROUPS,
  DEFECT_GROUP_LABELS,
  STOP_REASON_DEFECT_GROUP,
  defectGroupLabel,
  isDefectGroup,
  stopReasonToDefectGroup,
} from "../src/constants/hata-gruplari";
import { MACHINE_STOP_REASONS } from "../src/constants/reason-presets";
import { baseWriteClosedFields } from "../src/constants/write-guard";
import { normalizeDefectGroupBody } from "../src/services/helpers/defect-group.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const KOK = path.resolve(__dirname, "..", "..");
const KAYNAK = "Teks-Erp/src/constants/hata-gruplari.ts";
const AYNA = "Electron/src/lib/hata-gruplari.ts";
const HELPER = "Teks-Erp/src/services/helpers/defect-group.helper.ts";
const ROUTE = "Teks-Erp/src/routes/defect-type.routes.ts";
const read = (rel: string): string | null => {
  const p = path.join(KOK, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

// §1 küme
check("§1 küme altı grup, tekrarsız", DEFECT_GROUPS.length === 6 && new Set(DEFECT_GROUPS).size === 6, DEFECT_GROUPS.join(","));
check(
  "§1b her grubun Türkçe adı var",
  DEFECT_GROUPS.every((g) => typeof DEFECT_GROUP_LABELS[g] === "string" && DEFECT_GROUP_LABELS[g].length > 0) &&
    Object.keys(DEFECT_GROUP_LABELS).length === DEFECT_GROUPS.length,
);
check("§1c null → 'Gruplanmamış'", defectGroupLabel(null) === "Gruplanmamış" && defectGroupLabel("YOK") === "Gruplanmamış");

// §2 eşleme hedefleri kapalı kümede
const badTargets = Object.entries(STOP_REASON_DEFECT_GROUP).filter(([, g]) => g !== null && !isDefectGroup(g));
check("§2 eşleme hedefleri kapalı kümede ya da null", badTargets.length === 0, badTargets.map(([k]) => k).join(","));

// §3 iki yönlü eşleme
const stopCodes = MACHINE_STOP_REASONS.map((r) => r.code);
const unmapped = stopCodes.filter((c) => !Object.prototype.hasOwnProperty.call(STOP_REASON_DEFECT_GROUP, c));
const orphan = Object.keys(STOP_REASON_DEFECT_GROUP).filter((c) => !stopCodes.includes(c));
check("§3a her duruş kodu eşlemede beyanlı (grup ya da bilinçli null)", unmapped.length === 0, unmapped.join(","));
check("§3b eşlemede olmayan duruş kodu yok", orphan.length === 0, orphan.join(","));
check(
  "§3c çekirdek eşleme: COZGU_KOPUSU→COZGU, ATKI_KOPUSU→ATKI, bilinmeyen→null",
  stopReasonToDefectGroup("COZGU_KOPUSU") === "COZGU" &&
    stopReasonToDefectGroup("ATKI_KOPUSU") === "ATKI" &&
    stopReasonToDefectGroup("YOK_BOYLE") === null &&
    stopReasonToDefectGroup(null) === null,
);

// §4 gövde doğrulaması
function rejects(value: unknown): boolean {
  try {
    normalizeDefectGroupBody({ defectGroup: value });
    return false;
  } catch (e) {
    return e instanceof AppError && e.statusCode === 400 && (e.details as { code?: string } | undefined)?.code === "INVALID_DEFECT_GROUP";
  }
}
const okBody: Record<string, unknown> = { defectGroup: "COZGU" };
normalizeDefectGroupBody(okBody);
const emptyBody: Record<string, unknown> = { defectGroup: "" };
normalizeDefectGroupBody(emptyBody);
const absentBody: Record<string, unknown> = { name: "x" };
normalizeDefectGroupBody(absentBody);
check("§4a geçerli kod aynen geçer", okBody.defectGroup === "COZGU");
check("§4b boş dize → null (gruplanmamış)", emptyBody.defectGroup === null);
check("§4c alan gelmezse dokunulmaz (eski panel)", !("defectGroup" in absentBody));
check("§4d bilinmeyen / küçük harf / sayı → 400 INVALID_DEFECT_GROUP", rejects("XYZ") && rejects("cozgu") && rejects(5));

// §5 route iki yazma yolunda doğrular (tek boğaz writeWithDefault)
const route = read(ROUTE) ?? "";
const wwd = route.slice(route.indexOf("async function writeWithDefault"), route.indexOf('router.post("/"'));
const callIdx = wwd.indexOf("normalizeDefectGroupBody(body)");
const writeIdx = wwd.indexOf("defectTypeService.create");
check("§5 writeWithDefault yazmadan ÖNCE normalizeDefectGroupBody çağırır", callIdx >= 0 && writeIdx > callIdx);

// §6 ikinci liste yok
const GROUP_LITERAL = /["'`](COZGU|ATKI|MEKANIK)["'`]/;
const allowed = new Set([KAYNAK, AYNA]);
const offenders: string[] = [];
function walk(rel: string): void {
  const abs = path.join(KOK, rel);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const childRel = `${rel}/${name}`;
    const st = statSync(path.join(KOK, childRel));
    if (st.isDirectory()) walk(childRel);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !allowed.has(childRel)) {
      if (GROUP_LITERAL.test(readFileSync(path.join(KOK, childRel), "utf8"))) offenders.push(childRel);
    }
  }
}
["Teks-Erp/src", "Electron/src", "mobil/src"].forEach(walk);
check("§6 grup literal'i yalnız kaynak + aynada (ikinci liste yok)", offenders.length === 0, offenders.join(", "));
const helper = read(HELPER) ?? "";
check("§6b doğrulama kümeyi kaynaktan okur", /from "\.\.\/\.\.\/constants\/hata-gruplari"/.test(helper) && helper.includes("isDefectGroup("));

// §7 ayna
const src = read(KAYNAK);
const mirror = read(AYNA);
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
check("§7a kaynak ve ayna var", src !== null && mirror !== null, `${src?.length ?? 0} / ${mirror?.length ?? 0} bayt`);
check("§7b ayna BAYT-EŞİT (sha256)", src !== null && mirror !== null && sha(src) === sha(mirror), `düzelt: cp -p ${KAYNAK} ${AYNA}`);
check("§7c kaynak import'suz (ayna derlenebilsin)", src !== null && !/^\s*import\s/m.test(src));

// §8 genel CRUD kapısı açık
check("§8 write-guard defectGroup'u KAPATMAZ (doğrulamalı açık)", !baseWriteClosedFields("defectType").includes("defectGroup"));

async function dbRoundTrip(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("⏭ §9 DB gidiş-dönüş atlandı (DATABASE_URL yok)");
    return;
  }
  const { default: prisma } = await import("../src/lib/prisma");
  const { defectTypeService } = await import("../src/routes/defect-type.routes");
  let id: string | null = null;
  try {
    const body: Record<string, unknown> = { name: `R1BOYUT_SONDA_${Date.now()}`, defectGroup: "LEKE" };
    normalizeDefectGroupBody(body);
    const created = await defectTypeService.create(body, undefined);
    id = (created.data as { id: string }).id;
    const afterCreate = await prisma.defectType.findUnique({ where: { id }, select: { defectGroup: true } });
    check("§9a oluşturma gövdesindeki grup DB'ye yazılır", afterCreate?.defectGroup === "LEKE", String(afterCreate?.defectGroup));
    const upd: Record<string, unknown> = { defectGroup: "" };
    normalizeDefectGroupBody(upd);
    await defectTypeService.update(id, upd, undefined);
    const afterUpdate = await prisma.defectType.findUnique({ where: { id }, select: { defectGroup: true } });
    check("§9b güncellemede boş → gruplanmamış (null)", afterUpdate !== null && afterUpdate.defectGroup === null);
  } finally {
    // Sonda kaydı yalnız test DB'de doğar; deftere yazmamış taslak sınıfı.
    if (id) await prisma.defectType.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

dbRoundTrip()
  .catch((e) => check("§9 DB gidiş-dönüş", false, String(e)))
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    // Route modülü zamanlayıcı/bağlantı açık bırakır; çıkış açıkça verilir.
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
