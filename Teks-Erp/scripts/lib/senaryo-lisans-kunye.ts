// SENARYO L — L18: imzalı derleme künyesi uçtan uca. Geçici bir PAKET anahtarıyla küçük bir paket
// kökü imzalanır, fabrika sürecinde bütünlük denetimi o köke karşı koşturulur (IPC, test hedefi),
// motorun derleme tarihini İMZALI künyeden okuduğu ve bakım sonrası derlemeyi ek süreye düşürdüğü
// ölçülür; sonda hedef sıfırlanır (bugünkü davranış: liste yok → KAPSAM_DISI, DERLEME_TARIHI_YOK).
import fs from "node:fs";
import path from "node:path";
import { DAY_MS, isoToMs, msToIso } from "../../src/lib/license/protocol";
import { generatePackageKey, readPackageKey, signPackageDirectory, writePackageKey } from "./butunluk-imza";
import type { FabrikaIstemcisi } from "./senaryo-lisans-istemci";
import type { FabrikaSureci } from "./senaryo-lisans-surec";

type Kontrol = (ad: string, ok: boolean, ayrinti?: string) => boolean;

export async function l18KunyeOlc(g: {
  readonly kok: string;
  readonly surec: FabrikaSureci;
  readonly istemci: FabrikaIstemcisi;
  readonly kontrol: Kontrol;
  readonly simdiMs: number;
}): Promise<void> {
  const kodlar = async (): Promise<string[]> => (await g.istemci.detay()).durum.nedenler.map((n) => n.kod);
  const d0 = await g.istemci.detay();
  g.kontrol("imzalı künye yokken derleme tarihi ölçülmez (DERLEME_TARIHI_YOK, bugünkü davranış)", d0.durum.nedenler.some((n) => n.kod === "DERLEME_TARIHI_YOK"));
  const bakim = d0.hak ? isoToMs(d0.hak.bakimBitis) : g.simdiMs + 365 * DAY_MS;

  const kokDizin = path.join(g.kok, "paket-L18");
  fs.mkdirSync(path.join(kokDizin, "dist"), { recursive: true });
  fs.writeFileSync(path.join(kokDizin, "dist", "server.js"), "// senaryo L18\n");
  const anahtarDosyasi = writePackageKey(path.join(g.kok, "paket-anahtari-L18"), generatePackageKey("paket-senaryo", ["TEST"]));
  const key = readPackageKey(anahtarDosyasi);
  const imzala = (derlemeMs: number) =>
    signPackageDirectory({ root: kokDizin, key, urun: "backend", surum: "9.9.9", derlemeTarihi: msToIso(derlemeMs), musteri: null });

  await imzala(bakim + 5 * DAY_MS);
  const r1 = await g.surec.butunluk(kokDizin, { kid: key.kid, x: key.x });
  g.kontrol("imzalı künye doğrulandı (bütünlük GEÇERLİ)", r1.durum === "GECERLI", `${r1.durum} ${r1.kod ?? ""}`);
  const d1 = await g.istemci.detay();
  const k1 = d1.durum.nedenler.map((n) => n.kod);
  g.kontrol(
    "bakım bitişinden SONRA derlenmiş sürüm → BAKIM_IHLALI, ek süre sayacı (EK_SURE)",
    k1.includes("BAKIM_IHLALI") && !k1.includes("DERLEME_TARIHI_YOK") && d1.durum.ekSureKalanGun !== null,
    `${k1.join(",")} · kademe ${d1.durum.hesaplananKademe} · kalan ${d1.durum.ekSureKalanGun}`,
  );

  await imzala(bakim - DAY_MS);
  const r2 = await g.surec.butunluk(kokDizin, { kid: key.kid, x: key.x });
  const k2 = await kodlar();
  g.kontrol("bakım İÇİNDE derlenmiş sürüm → ihlal yok (künye ölçüldü)", r2.durum === "GECERLI" && !k2.includes("BAKIM_IHLALI") && !k2.includes("DERLEME_TARIHI_YOK"), k2.join(","));

  fs.appendFileSync(path.join(kokDizin, "dist", "server.js"), "// kurcalandı\n");
  const r3 = await g.surec.butunluk(kokDizin, { kid: key.kid, x: key.x });
  const k3 = await kodlar();
  g.kontrol("kurcalanmış dosya → BUTUNLUK_GECERSIZ (lisans merdiveni)", r3.durum === "GECERSIZ" && r3.kod === "BUTUNLUK_UYUSMAZ" && k3.includes("BUTUNLUK_GECERSIZ"), `${r3.durum} ${r3.kod ?? ""}`);

  const z = await g.surec.butunluk(null, null);
  const kz = await kodlar();
  g.kontrol("hedef sıfırlandı → KAPSAM_DISI, DERLEME_TARIHI_YOK geri", z.durum === "KAPSAM_DISI" && kz.includes("DERLEME_TARIHI_YOK") && !kz.includes("BUTUNLUK_GECERSIZ"), `${z.durum} · ${kz.join(",")}`);
}
