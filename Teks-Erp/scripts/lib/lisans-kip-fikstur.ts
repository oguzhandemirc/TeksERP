// Lisans KİP fikstürü — kapı ve modül tavanı bekçileri için motoru bellekte istenen kademeye
// kurar: geçici `LICENSE_DIR` + gerçek imzalı HAK/kira + kurulum anahtarıyla imzalı durum
// kaydı. DB'ye dokunmaz (kurulum kimliği bellek olgusu olarak verilir). `test_` öneki yok →
// koşucu bunu bekçi saymaz. Anahtarlar çalışma anında üretilir, diske yalnız geçici dizine.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicKey, randomUUID } from "node:crypto";
import { DAY_MS, LeaseSchema, TYP, msToIso, signDocument, type LeaseDoc, type SanctionLevel } from "../../src/lib/license/protocol";
import { LICENSE_FILES, loadLicenseStoreSync, saveEntitlement, saveLease, saveLicenseIdentity, saveStateRecord } from "../../src/lib/license/store";
import { setLicenseTraceRow } from "../../src/lib/license/trace-row";
import {
  __resetLicenseRuntimeForTests,
  configureLicenseRuntimeForTests,
  getLicenseSnapshot,
  invalidateLicenseSnapshot,
  setLicenseDbFacts,
  setMeasuredFingerprint,
  type LicenseSnapshot,
} from "../../src/lib/license/runtime";
import { sanctionSnapshotOf } from "../../src/lib/license/state";
import { signStateRecord } from "../../src/lib/license/saat";
import type { Fingerprint } from "../../src/lib/license/protocol";
import { fiksturKur, hakBas, kiraYuku, sertifikaBas, sertifikaYuku, type Fikstur } from "./lisans-fikstur";

export interface KipSecenegi {
  /** Kira zorlaması: false = gözlem (uygulanan etki bugünkü davranış). */
  readonly zorlama: boolean;
  readonly kademe?: SanctionLevel | null;
  readonly donmus?: readonly string[];
  /** HAK modül listesi (varsayılan: fikstürün üçlüsü — üretim · finans · ticaret). */
  readonly moduller?: readonly string[];
  /** false → parmak izi ölçülmedi (geçerlilik ÖLÇÜLEMEDİ = belirsizlik). */
  readonly parmakIziOlculdu?: boolean;
  /** true → kira 10 gün önce bitti (EK_SURE; ek süre 30 gün). */
  readonly kiraBitti?: boolean;
  /** Kiranın ek alanları (ör. patron bulutu: `esitlemeAraligiDk`, `patronBulutBitis`, `devredildi`). */
  readonly kiraEk?: Partial<Pick<LeaseDoc, "esitlemeAraligiDk" | "patronBulutBitis" | "devredildi">>;
  /**
   * true → kurulum anahtarı dosyası okunamaz (izin 000) ve DB izi bellekte (açık anahtar + durum kaydı kopyası): imza
   * durur, kararlar sürer (G12 §3.1-1). Yalnız Windows dışı ve root olmayan süreçte anlamlıdır.
   */
  readonly anahtarOkunamaz?: boolean;
}

let kokDizin: string | null = null;
let kilitliAnahtar: string | null = null;

/** Önceki kurulumun kilitlediği anahtar dosyasının iznini geri verir (fikstür aynı dizini yeniden kullanır). */
function kilidiAc(): void {
  if (kilitliAnahtar) fs.chmodSync(kilitliAnahtar, 0o600);
  kilitliAnahtar = null;
}

/** Geçici lisans deposu kökü (süreç başına bir kez); `temizleLisansKipDizini` siler. */
function depoDizini(): string {
  kokDizin ??= fs.mkdtempSync(path.join(os.tmpdir(), "lisans-kip-"));
  return path.join(kokDizin, "lisans");
}

/** Motoru istenen kipe kurar ve anlık görüntüyü döndürür. */
export function lisansKipKur(s: KipSecenegi): { f: Fikstur; snap: LicenseSnapshot } {
  kilidiAc();
  // Önceki kurulumun kimlik dosyası (yalnız anahtarsız kipte yazılır) yeni fikstürün kimliğini ezmesin.
  fs.rmSync(path.join(depoDizini(), LICENSE_FILES.IDENTITY), { force: true });
  __resetLicenseRuntimeForTests();
  const store = loadLicenseStoreSync({ dir: depoDizini() });
  const key = store.key;
  if (!key) throw new Error("lisans deposu anahtarı üretilemedi");
  const simdi = Date.now();
  const f0 = fiksturKur(simdi);
  const f: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: null });
  setLicenseDbFacts({ installationId: f.kurulumId, firstOpenMs: simdi - 100 * DAY_MS, ledgerHighWaterMs: null });
  const tum = { f1: true, f2: true, f3: true, f4: true, f5: true };
  setMeasuredFingerprint(
    s.parmakIziOlculdu === false ? null : { digest: f.parmakIzi as Fingerprint, measured: tum, measuredAt: new Date(simdi).toISOString() },
  );
  saveEntitlement(hakBas(f, s.moduller ? { moduller: [...s.moduller] } : {}));

  const verilis = s.kiraBitti ? simdi - 40 * DAY_MS : simdi - 60 * 60 * 1000;
  const bitis = s.kiraBitti ? simdi - 10 * DAY_MS : simdi + 29 * DAY_MS;
  // Alt sertifika kiranın İMZA ANINDA geçerli olmalı: eski tarihli kira için başlangıç geriye çekilir.
  const altSertifika = sertifikaBas(
    f.kok,
    sertifikaYuku(f, f.alt, "ALT", { baslangic: msToIso(verilis - DAY_MS), bitis: msToIso(simdi + 100 * DAY_MS) }),
  );
  const yuk = kiraYuku(f, {
    altSertifika,
    kiraId: randomUUID(),
    verilis: msToIso(verilis),
    bitis: msToIso(bitis),
    sunucuSaati: msToIso(verilis),
    zorlama: s.zorlama,
    yaptirim: {
      kademe: s.kademe ?? null,
      mesaj: null,
      kisitlamaTarihi: null,
      donmusModuller: [...(s.donmus ?? [])],
      guncellemeDonuk: false,
    },
    ...(s.kiraEk ?? {}),
  });
  saveLease(signDocument({ typ: TYP.KIRA, schema: LeaseSchema, payload: yuk, key: f.alt }));
  // Birikim = kiradan beri geçen süre: monotonik tahmin duvar saatiyle örtüşür (saat bulgusu yok).
  const kayit = signStateRecord(
    {
      v: 1,
      kurulumId: f.kurulumId,
      kiraId: yuk.kiraId,
      birikenMs: simdi - verilis,
      yazildi: msToIso(simdi),
      yuksekSu: msToIso(verilis),
      sonKiraZorlamasi: yuk.zorlama,
      sonYaptirim: sanctionSnapshotOf(yuk),
      sira: 0,
    },
    key.privateKey,
    key.x,
  );
  saveStateRecord(kayit);
  if (s.anahtarOkunamaz) {
    // Anahtarsız süreç açık anahtarı DB izinden, izi lisans kimliğiyle (kimlik dosyası) eşler.
    saveLicenseIdentity(f.kurulumId);
    setLicenseTraceRow({ v: 1, kurulumId: f.kurulumId, anahtar: key.x, durum: kayit });
    kilitliAnahtar = path.join(depoDizini(), LICENSE_FILES.KEY);
    fs.chmodSync(kilitliAnahtar, 0o000);
  }
  loadLicenseStoreSync({ dir: depoDizini() });
  invalidateLicenseSnapshot();
  return { f, snap: getLicenseSnapshot() };
}

/** Motoru "hazır değil" durumuna düşürür (kurulum kimliği yok) — kapı fail-open olmalı. */
export function lisansHazirDegil(): LicenseSnapshot {
  setLicenseDbFacts({ installationId: null });
  return getLicenseSnapshot();
}

export function temizleLisansKipDizini(): void {
  kilidiAc();
  if (kokDizin) fs.rmSync(kokDizin, { recursive: true, force: true });
  kokDizin = null;
  __resetLicenseRuntimeForTests();
}
