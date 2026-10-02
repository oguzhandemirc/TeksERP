// SENARYO L — L38: donanım değişikliği (K8). Tasarım `docs/design/LISANS-V2-CEVRIMDISI-KIRA.md` §3.1-6 "Meşru
// değişiklik" · §6 K8; kural `docs/kurallar/lisans.md:128` (öğrenme + bildirim) · :79 (zarf); arşiv L2-10 · L2-11.
// Parmak izi süreç ortamından enjekte edilir (yeniden açılışta yeni değer = makinede donanım değişti).
import type { LisansDetayi, Yanit } from "./senaryo-lisans-istemci";
import { nedenOzeti } from "./senaryo-lisans-v2-duzenek";
import type { G4Baglami } from "./senaryo-lisans-v2-g4";
import { kur, type AdimYuzu, type RolFabrika } from "./senaryo-lisans-v2-merdiven";

type Talep = { id: string; kurulumId: string; tur: string; durum: string };
const ozet = (y: Yanit): string => `${y.status}${y.kod ? ` ${y.kod}` : ""}`;
const durumu = (d: LisansDetayi): string =>
  `${d.durum.gecerlilik} ${d.durum.hesaplananKademe}/${d.durum.uygulananKademe} parmakIzi=${d.parmakIzi.karar}(${String(d.parmakIzi.eslesen)}/${String(d.parmakIzi.olculebilen)}) [${nedenOzeti(d)}]`;
const tamam = (d: LisansDetayi): boolean => d.durum.gecerlilik === "GECERLI" && d.durum.uygulananKademe === "NORMAL" && d.parmakIzi.karar === "ESLESTI";

async function bekleyenTalep<F extends RolFabrika>(b: G4Baglami<F>, dbId: string): Promise<Talep | null> {
  const l = await b.portal.istek("GET", "/donanim-talepleri?durum=BEKLIYOR");
  return ((l.veri.items ?? []) as Talep[]).find((t) => t.kurulumId === dbId) ?? null;
}

/** Portal kuyruğundaki talebi onaylar; kanıtı döndürür. */
async function onayla<F extends RolFabrika>(b: G4Baglami<F>, dbId: string, etiket: string): Promise<{ ok: boolean; kanit: string }> {
  const t = await bekleyenTalep(b, dbId);
  if (!t) return { ok: false, kanit: "BEKLIYOR talep yok" };
  const o = await b.portal.istek("POST", `/donanim-talepleri/${t.id}/onayla`, { sebep: `Senaryo L38 ${etiket}` });
  return { ok: o.status === 200 && o.veri.durum === "ONAYLANDI", kanit: `talep ${t.tur} BEKLIYOR → onay ${ozet(o)} ${String(o.veri.durum)}` };
}

/** Fabrika dururken parmak izi değişir (ioreg sahtesi), yeniden açılır. */
async function donanimDegistir<F extends RolFabrika>(b: G4Baglami<F>, f: F & { readonly parmakIzi: { makine: string; seri: string } }, alan: "makine" | "seri", deger: string): Promise<void> {
  await b.durdur(f);
  f.parmakIzi[alan] = deger;
  await b.baslat(f);
}

// ============================================================ L38
export async function l38Donanim<F extends RolFabrika & { readonly parmakIzi: { makine: string; seri: string } }>(b: G4Baglami<F>, a: AdimYuzu): Promise<void> {
  const k = await kur(b, a, "R", { parmakIzi: { makine: "5E0A0001-0000-4000-8000-0000000000E5", seri: "SENARYOR01" } });
  if (!k) return;
  const f = k.f;
  a.not("güçlü ≥ 2 kendiliğinden öğrenme bu makinede kurulamaz: darwin toplayıcısı yalnız f1 (ioreg-uuid) + f4 (ioreg-seri) okur (fingerprint-paths.ts:56–57) — güçlü etken 1, küme ZAYIF (K8 netleştirmesi); ölçülen yol portal onayıdır");
  // (a) çevrimiçi: anakart serisi (f4) değişir → zayıf kural tutmaz, satıcı öğrenmez; panel "bildir" → kuyruk → onay.
  await donanimDegistir(b, f, "seri", "SENARYOR02");
  const y0 = await f.istemci.yokla();
  const d0 = await f.istemci.detay();
  a.kontrol(
    "çevrimiçi, f4 değişti (eşik altı): satıcı kendiliğinden öğrenmez; fabrika aniden durmaz (KISITLI değil) — §3.1-6 karar · 'kayıp/uyuşmazlık iptal değil'",
    d0.parmakIzi.karar !== "ESLESTI" && d0.durum.hesaplananKademe !== "KISITLI",
    `yoklama=${y0.outcome} ${y0.code ?? ""} ${durumu(d0)}`,
  );
  const kira0 = d0.kira?.kiraId;
  const bil = await f.istemci.istek("POST", "/api/license/donanim-bildir", { gerekce: "Senaryo L38 anakart değişti" });
  const t1 = await bekleyenTalep(b, k.dbId);
  a.kontrol(
    "panel 'Donanım değişikliğini bildir' → güçlüler tutmuyor → portal onay kuyruğuna düşer (BEKLIYOR), lisansa dokunulmaz — §3.1-6 meşru değişiklik · lisans.md:128",
    bil.status === 200 && bil.veri.durum === "BEKLIYOR" && t1 !== null && (await f.istemci.detay()).kira?.kiraId === kira0,
    `${ozet(bil)} durum=${String(bil.veri.durum)} talep=${t1 ? `${t1.tur} ${t1.durum}` : "yok"}`,
  );
  const o1 = await onayla(b, k.dbId, "çevrimiçi onay");
  const once = (await f.istemci.detay()).kira?.kiraId;
  await f.istemci.yokla();
  const d1 = (await f.istemci.bekle((d) => d.kira?.kiraId !== once && tamam(d), 20_000)).detay;
  a.kontrol("portal onayı → ONAYLANDI; yeni kira yeni kümeyi taşır → ESLESTI, NORMAL — §3.1-6 · L2-11 portal kararı", o1.ok && tamam(d1), `${o1.kanit} · ${durumu(d1)}`);
  await cevrimdisiZarf(b, a, f, k.dbId);
  await b.durdur(f);
}

/** (b) internetsiz: QR/zarf (`amac: donanim`) → BEKLIYOR → onay → ONAYLANDI kirası kabul — lisans.md:79. */
async function cevrimdisiZarf<F extends RolFabrika & { readonly parmakIzi: { makine: string; seri: string } }>(b: G4Baglami<F>, a: AdimYuzu, f: F, dbId: string): Promise<void> {
  f.aktarici.kipAyarla("kesik");
  await donanimDegistir(b, f, "makine", "5E0A0001-0000-4000-8000-0000000000E6");
  const zarf = async (): Promise<{ istek: Yanit; durum: number; yanit: Record<string, unknown> }> => {
    const istek = await f.istemci.istek("POST", "/api/license/cevrimdisi-istek", { amac: "donanim", gerekce: "Senaryo L38 internetsiz makine değişimi" });
    const r = await fetch(`${b.saticiGenel}/v1/cevrimdisi`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(istek.veri.istekGovdesi) });
    return { istek, durum: r.status, yanit: (await r.json()) as Record<string, unknown> };
  };
  const once = (await f.istemci.detay()).kira?.kiraId;
  const z1 = await zarf();
  const k1 = await f.istemci.istek("POST", "/api/license/cevrimdisi-yanit", { yanit: z1.yanit });
  const t1 = await bekleyenTalep(b, dbId);
  a.kontrol(
    "internetsiz: donanım zarfı (/v1/cevrimdisi) → satıcı BEKLIYOR; fabrika yanıtı 409 LICENSE_HARDWARE_PENDING (başka kodla düşmez), lisansa dokunulmaz — lisans.md:79 · arşiv L2-7 B",
    z1.istek.status === 200 && z1.durum === 200 && z1.yanit.durum === "BEKLIYOR" && k1.status === 409 && k1.kod === "LICENSE_HARDWARE_PENDING" && t1 !== null && (await f.istemci.detay()).kira?.kiraId === once,
    `istek=${ozet(z1.istek)} satıcı=${z1.durum} ${String(z1.yanit.durum)} → fabrika ${ozet(k1)} talep=${t1 ? t1.tur : "yok"}`,
  );
  const o = await onayla(b, dbId, "zarf onayı");
  const z2 = await zarf();
  const k2 = await f.istemci.istek("POST", "/api/license/cevrimdisi-yanit", { yanit: z2.yanit });
  const d2 = await f.istemci.detay();
  a.kontrol(
    "onay → ONAYLANDI; yeni zarfın yanıtı ONAYLANDI + lisans → fabrika kabul eder (yeni kira, ESLESTI, NORMAL) — §3.1-6 'çevrimdışıyken QR öğretir' · lisans.md:79",
    o.ok && z2.yanit.durum === "ONAYLANDI" && Boolean(z2.yanit.lisans) && k2.status === 200 && d2.kira?.kiraId !== once && tamam(d2),
    `${o.kanit} · satıcı ${String(z2.yanit.durum)} lisans=${z2.yanit.lisans ? "var" : "yok"} → fabrika ${ozet(k2)} · ${durumu(d2)}`,
  );
  f.aktarici.kipAyarla("acik");
}
