// KÖK KUYRUĞU İNCELEMESİ (Mac, kök imzasından ÖNCE; saf — DB'siz, ağsız). VDS ele geçirilip kuyruğa sahte talep konsa da
// imzalayan kişi farkı görsün diye: her talebin yükü, VDS'in gönderdiği taban sürümün İMZALI belgesiyle (köke karşı
// doğrulanır) karşılaştırılır. Kimlik uyuşmazlığı ya da doğrulanamayan taban ŞÜPHELİ'dir ve imzalanmaz; taban hiç
// gelmediyse (eski satıcı) bu açıkça yazılır, fark gösterilemez. Kullanıcılar: `anahtar.ts kuyruk-incele` ·
// `kuyruk-imzala` (şüpheli talep varsa RED) · `deploy/satici/uretim-toren.mjs kuyruk`.
import { EntitlementSchema, decodeDocument, verifyEntitlement, type EntitlementDoc, type RootKey } from "../lisans-protokol";

export const ROOT_QUEUE_REVIEW_TYPE = "tekserp-kok-kuyrugu-inceleme";
/** Yük "şimdi"den bu kadar ileri tarihliyse şüpheli (fabrika da `BELGE_ILERI_TARIHLI` der). */
const FUTURE_TOLERANCE_MS = 10 * 60_000;

export type PreviousState = "DOGRULANDI" | "ILK_SURUM" | "OKUNAMADI" | "DOGRULANAMADI";

export interface FieldDiff {
  readonly alan: "sinif" | "moduller" | "kalici" | "bakimBitis" | "cevrimdisiUfukGun" | "kipAltSiniri";
  readonly once: string;
  readonly sonra: string;
  /** Hakkı GENİŞLETİYOR mu (modül eklenir · bakım uzar · ufuk büyür · kalıcı olur · kip alt sınırı kalkar · sınıf değişir). */
  readonly genisler: boolean;
}

export interface RequestReview {
  readonly talepId: string;
  readonly hakId: string;
  readonly lisansNo: string;
  readonly musteri: string;
  readonly tesis: string;
  readonly kurulumId: string;
  readonly sinif: string;
  readonly tabanSurum: number;
  readonly surum: number;
  readonly acil: boolean;
  readonly planNedeni: string | null;
  readonly sebep: string | null;
  readonly onceki: { readonly durum: PreviousState; readonly imzaci: string | null; readonly aciklama: string };
  readonly farklar: readonly FieldDiff[];
  /** Boş değilse talep ŞÜPHELİ: imzalanmaz. */
  readonly supheler: readonly string[];
  readonly uyarilar: readonly string[];
  /** İnsan okunur blok (tören bunu basar). */
  readonly satirlar: readonly string[];
}

export interface QueueReview {
  readonly v: 1;
  readonly tur: typeof ROOT_QUEUE_REVIEW_TYPE;
  readonly talepler: readonly RequestReview[];
}

export function canonicalOf(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(walk(value));
}

const day = (iso: string): string => iso.slice(0, 10);
const horizonText = (h: number | null | undefined): string => (h === undefined ? "alan yok (eski HAK)" : h === null ? "süresiz" : `${h} gün`);
const horizonRank = (h: number | null | undefined): number => (h === undefined ? -1 : h === null ? Number.POSITIVE_INFINITY : h);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Yeni yük ile taban arasındaki alan farkları (yalnız değişenler). */
export function entitlementDiff(before: EntitlementDoc, after: EntitlementDoc): FieldDiff[] {
  const out: FieldDiff[] = [];
  if (before.sinif !== after.sinif) out.push({ alan: "sinif", once: before.sinif, sonra: after.sinif, genisler: true });
  const added = after.moduller.filter((m) => !before.moduller.includes(m));
  const removed = before.moduller.filter((m) => !after.moduller.includes(m));
  if (added.length || removed.length) {
    out.push({ alan: "moduller", once: removed.length ? `− ${removed.join(", ")}` : "", sonra: added.length ? `+ ${added.join(", ")}` : "", genisler: added.length > 0 });
  }
  if (before.kalici !== after.kalici) out.push({ alan: "kalici", once: before.kalici ? "kalıcı" : "vadeli", sonra: after.kalici ? "kalıcı" : "vadeli", genisler: after.kalici });
  if (before.bakimBitis !== after.bakimBitis) {
    out.push({ alan: "bakimBitis", once: day(before.bakimBitis), sonra: day(after.bakimBitis), genisler: Date.parse(after.bakimBitis) > Date.parse(before.bakimBitis) });
  }
  if (horizonRank(before.cevrimdisiUfukGun) !== horizonRank(after.cevrimdisiUfukGun)) {
    out.push({ alan: "cevrimdisiUfukGun", once: horizonText(before.cevrimdisiUfukGun), sonra: horizonText(after.cevrimdisiUfukGun), genisler: horizonRank(after.cevrimdisiUfukGun) > horizonRank(before.cevrimdisiUfukGun) });
  }
  if (before.kipAltSiniri !== after.kipAltSiniri) {
    out.push({ alan: "kipAltSiniri", once: before.kipAltSiniri ?? "yok", sonra: after.kipAltSiniri ?? "yok", genisler: before.kipAltSiniri === "zorla" });
  }
  return out;
}

const FIELD_LABEL: Record<FieldDiff["alan"], string> = {
  sinif: "Sınıf",
  moduller: "Modüller",
  kalici: "Kalıcılık",
  bakimBitis: "Bakım bitişi",
  cevrimdisiUfukGun: "Çevrimdışı ufuk",
  kipAltSiniri: "Kip alt sınırı",
};

export const QUEUE_REASON_TEXT: Record<string, string> = {
  YETENEK_YOK: "eski derleme (ara imzalı HAK'ı tanımıyor) → kurulumu güncelleyin",
  ARA_IMZACI_YOK: "ara imzacı bu sınıfı kapsamıyor ya da geçersiz → yeni ara imzacı",
};

interface RawRequest {
  talepId?: unknown;
  hakId?: unknown;
  lisansNo?: unknown;
  tabanSurum?: unknown;
  surum?: unknown;
  acil?: unknown;
  planNedeni?: unknown;
  sebep?: unknown;
  onceki?: unknown;
  yuk?: unknown;
}

/** İnsan okunur talep bloğu (tören ekranı + inceleme arşivi). */
function reviewLines(x: {
  talepId: string;
  r: RawRequest;
  doc: EntitlementDoc | null;
  tabanSurum: number;
  reason: string | null;
  previous: RequestReview["onceki"];
  diffs: readonly FieldDiff[];
  warnings: readonly string[];
  suspicions: readonly string[];
}): string[] {
  const { talepId, r, doc, tabanSurum, reason, previous, diffs, warnings, suspicions } = x;
  const lines: string[] = [];
  const head = suspicions.length ? "ŞÜPHELİ — İMZALANMAZ" : r.acil === true ? "ACİL" : "";
  lines.push(`Talep ${talepId}${head ? `  [${head}]` : ""}`);
  lines.push(`  Müşteri  : ${doc?.musteri.ad ?? "?"} · tesis ${doc?.tesis.ad ?? "?"}`);
  lines.push(`  Kurulum  : ${doc?.kurulumId ?? "?"} · lisans ${doc?.lisansNo ?? str(r.lisansNo)}`);
  lines.push(`  Sınıf    : ${doc?.sinif ?? "?"} · sürüm ${tabanSurum} → ${String(r.surum)}`);
  lines.push(`  Neden    : ${reason ? (QUEUE_REASON_TEXT[reason] ?? reason) : "satıcı bildirmedi (eski sürüm)"}${typeof r.sebep === "string" ? ` · sebep "${r.sebep}"` : ""}`);
  lines.push(`  Önceki   : ${previous.aciklama}`);
  if (previous.durum === "DOGRULANDI") {
    if (diffs.length === 0) lines.push("  Fark     : YOK (aynı şartlar yeniden imzalanır)");
    for (const d of diffs) lines.push(`  Fark     : ${FIELD_LABEL[d.alan]}: ${d.once || "—"} → ${d.sonra || "—"}${d.genisler ? "  ▲ GENİŞLER" : ""}`);
  }
  if (doc) {
    lines.push(`  Yeni     : modüller ${doc.moduller.join(", ") || "(yok)"} · ${doc.kalici ? "kalıcı" : "vadeli"} · bakım ${day(doc.bakimBitis)} · ufuk ${horizonText(doc.cevrimdisiUfukGun)}${doc.kipAltSiniri ? " · kip zorla" : ""}`);
  }
  for (const w of warnings) lines.push(`  Uyarı    : ${w}`);
  for (const s of suspicions) lines.push(`  ŞÜPHE    : ${s}`);
  return lines;
}

function reviewOne(r: RawRequest, anchor: readonly RootKey[], nowMs: number, seen: { talep: Set<string>; hak: Set<string> }): RequestReview {
  const suspicions: string[] = [];
  const warnings: string[] = [];
  const talepId = str(r.talepId);
  const decoded = decodeDocument(EntitlementSchema, r.yuk);
  const doc = decoded.ok ? decoded.value : null;
  if (!decoded.ok) suspicions.push(`yük HAK şemasına uymuyor (${decoded.message})`);
  else if (canonicalOf(decoded.value) !== canonicalOf(r.yuk)) suspicions.push("yük şemadan AYNEN geçmiyor (fazla/eksik alan)");
  if (doc && (doc.imzaciSertifikasi || doc.bayiSertifikasi)) suspicions.push("kök imzalı HAK imzacı sertifikası taşıyamaz");
  if (doc && !anchor.some((k) => k.classes.includes(doc.sinif))) suspicions.push(`kök ${doc.sinif} sınıfına yetkili değil`);
  if (doc && (doc.hakId !== r.hakId || doc.surum !== r.surum)) suspicions.push("yükün hakId/sürümü talep satırıyla uyuşmuyor");
  if (doc && typeof r.lisansNo === "string" && doc.lisansNo !== r.lisansNo) suspicions.push(`yükün lisans numarası (${doc.lisansNo}) talep satırıyla (${r.lisansNo}) uyuşmuyor`);
  if (typeof r.tabanSurum !== "number" || r.surum !== r.tabanSurum + 1) suspicions.push("sürüm taban + 1 değil");
  if (doc && Date.parse(doc.verilis) > nowMs + FUTURE_TOLERANCE_MS) suspicions.push(`veriliş zamanı ileri tarihli (${doc.verilis})`);
  if (seen.talep.has(talepId)) suspicions.push("aynı talep kimliği kuyrukta iki kez");
  if (typeof r.hakId === "string" && seen.hak.has(r.hakId)) suspicions.push("aynı HAK için kuyrukta ikinci talep (HAK başına tek bekleyen talep olur)");
  seen.talep.add(talepId);
  if (typeof r.hakId === "string") seen.hak.add(r.hakId);

  let previous: RequestReview["onceki"];
  let diffs: FieldDiff[] = [];
  const tabanSurum = typeof r.tabanSurum === "number" ? r.tabanSurum : -1;
  if (tabanSurum === 0) {
    previous = { durum: "ILK_SURUM", imzaci: null, aciklama: "önceki HAK yok — İLK sürüm: bütün alanları kendiniz denetleyin" };
    warnings.push("ilk sürüm: karşılaştırılacak önceki HAK yok");
  } else if (!("onceki" in r)) {
    previous = { durum: "OKUNAMADI", imzaci: null, aciklama: "ÖNCEKİ HAK OKUNAMADI — satıcı göndermedi (eski satıcı sürümü); fark gösterilemiyor, yükü kendiniz denetleyin" };
    warnings.push("önceki HAK okunamadı: fark yok");
  } else if (r.onceki === null || typeof r.onceki !== "object") {
    previous = { durum: "OKUNAMADI", imzaci: null, aciklama: `ÖNCEKİ HAK OKUNAMADI — satıcı defterinde sürüm ${tabanSurum} yok; fark gösterilemiyor` };
    warnings.push("önceki HAK okunamadı: fark yok");
  } else {
    const p = r.onceki as { surum?: unknown; belge?: unknown };
    const v = verifyEntitlement(p.belge, anchor);
    if (!v.ok) {
      previous = { durum: "DOGRULANAMADI", imzaci: null, aciklama: `önceki HAK köke karşı DOĞRULANAMADI (${v.code})` };
      suspicions.push(`önceki HAK doğrulanamadı (${v.code}) — taban sahte olabilir`);
    } else {
      const before = v.value.document;
      const signer = `${v.value.signer.kind} ${v.value.signer.kid}`;
      previous = { durum: "DOGRULANDI", imzaci: signer, aciklama: `sürüm ${before.surum}, ${signer} imzalı — köke karşı doğrulandı` };
      if (p.surum !== tabanSurum || before.surum !== tabanSurum) suspicions.push(`önceki HAK sürüm ${before.surum}, talebin tabanı ${tabanSurum}`);
      if (doc) {
        for (const [name, a, b] of [
          ["hakId", before.hakId, doc.hakId],
          ["kurulumId", before.kurulumId, doc.kurulumId],
          ["lisansNo", before.lisansNo, doc.lisansNo],
          ["müşteri", before.musteri.id, doc.musteri.id],
          ["tesis", before.tesis.id, doc.tesis.id],
        ] as const) {
          if (a !== b) suspicions.push(`${name} önceki HAK'tan farklı (${a} → ${b})`);
        }
        diffs = entitlementDiff(before, doc);
        if (v.value.signer.kind === "ARA") warnings.push("önceki HAK VDS'teki ara imzacıyla imzalı: fark ona göre — yeni yükün TAM şartlarına da bakın");
      }
    }
  }
  if (diffs.some((d) => d.alan === "sinif")) warnings.push("SINIF DEĞİŞİYOR");

  const reason = typeof r.planNedeni === "string" ? r.planNedeni : null;
  const lines = reviewLines({ talepId, r, doc, tabanSurum, reason, previous, diffs, warnings, suspicions });

  return {
    talepId,
    hakId: str(r.hakId),
    lisansNo: doc?.lisansNo ?? str(r.lisansNo),
    musteri: doc?.musteri.ad ?? "",
    tesis: doc?.tesis.ad ?? "",
    kurulumId: doc?.kurulumId ?? "",
    sinif: doc?.sinif ?? "",
    tabanSurum,
    surum: typeof r.surum === "number" ? r.surum : -1,
    acil: r.acil === true,
    planNedeni: reason,
    sebep: typeof r.sebep === "string" ? r.sebep : null,
    onceki: previous,
    farklar: diffs,
    supheler: suspicions,
    uyarilar: warnings,
    satirlar: lines,
  };
}

/** Kuyruk dosyasını (VDS `kuyruk-disa-aktar`) köke karşı inceler; biçim tanınmazsa fırlatır. */
export function reviewRootQueue(input: unknown, anchor: readonly RootKey[], nowMs: number = Date.now()): QueueReview {
  const q = input as { v?: unknown; tur?: unknown; talepler?: unknown };
  if (!q || q.v !== 1 || q.tur !== "tekserp-kok-kuyrugu" || !Array.isArray(q.talepler)) throw new Error("Kuyruk dosyası tanınmıyor (tekserp-kok-kuyrugu)");
  const seen = { talep: new Set<string>(), hak: new Set<string>() };
  return { v: 1, tur: ROOT_QUEUE_REVIEW_TYPE, talepler: (q.talepler as RawRequest[]).map((r) => reviewOne(r ?? {}, anchor, nowMs, seen)) };
}
