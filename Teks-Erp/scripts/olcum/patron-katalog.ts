// =============================================================================
// PATRON BULUTU — PROJEKSİYON KATALOĞU (ölçüm betiklerinin görünümü)
// =============================================================================
// Tek kaynak artık KODDUR: `src/cloud-sync/projections.ts`. Bu dosya o kataloğu üç ölçüm
// betiğinin (`patron-sema-olcumu` · `patron-hacim-olcumu` · `patron-yazim-noktalari`)
// okuduğu Türkçe biçime ÇEVİRİR — elle satır eklenmez; katalog değişince burası kendiliğinden
// değişir. (B1 tasarım diliminin taslağı B1-kod diliminde bu görünüme indi.)
// =============================================================================
import {
  DELIBERATELY_EXCLUDED,
  RECORD_PROJECTIONS,
  SNAPSHOT_PROJECTIONS,
  SYNC_AUX_READS,
  type DataClass,
  type RecordProjection,
} from "../../src/cloud-sync/projections";

export type VeriSinifi = DataClass;

export interface Kolon {
  tel: string;
  kaynak: string;
  sinif?: VeriSinifi;
}

export interface Turetilmis {
  tel: string;
  yardimci: string;
  zamanaBagli?: boolean;
  sinif?: VeriSinifi;
}

export interface Bagimlilik {
  tablo: string;
  filigran: "updatedAt" | "createdAt" | "isaret";
  kokeYol: string;
}

export type SilmeStratejisi = "YOK" | "DAMGA" | "KAPSAM_DISI";

export interface KayitProjeksiyonu {
  ad: string;
  tur: "KAYIT";
  rol: "BOYUT" | "OLGU";
  kok: { tablo: string; model: string };
  kapsam?: string;
  kolonlar: Kolon[];
  turetilmis: Turetilmis[];
  bagimliliklar: Bagimlilik[];
  silme: SilmeStratejisi;
  izin: string;
  modul?: string;
}

export interface AnlikProjeksiyon {
  ad: string;
  tur: "ANLIK";
  kaynak: string;
  siklik: "HER_TUR" | "SAATLIK" | "GUNLUK";
  izin: string;
  modul?: string;
  okudugu: string[];
}

export type Projeksiyon = KayitProjeksiyonu | AnlikProjeksiyon;

function kokeYol(p: RecordProjection, i: number): string {
  const r = p.sources[i]!.root;
  if (r.kind === "self") return "self";
  if (r.kind === "column") return `${p.sources[i]!.table}.${r.column}`;
  return `${p.sources[i]!.table}.${r.keyColumn} → sorgu`;
}

function kayit(p: RecordProjection): KayitProjeksiyonu {
  return {
    ad: p.name,
    tur: "KAYIT",
    rol: p.role,
    kok: { tablo: p.root.table, model: p.root.model },
    ...(p.scope ? { kapsam: p.scope.note } : {}),
    kolonlar: p.columns.map((c) => ({ tel: c.wire, kaynak: c.source, ...(c.dataClass !== "ISLEM" ? { sinif: c.dataClass } : {}) })),
    turetilmis: p.derived.map((d) => ({
      tel: d.wire,
      yardimci: d.helper,
      ...(d.timeBound ? { zamanaBagli: true } : {}),
      ...(d.dataClass !== "ISLEM" ? { sinif: d.dataClass } : {}),
    })),
    bagimliliklar: [
      ...p.sources.map((s, i) => ({ tablo: s.table, filigran: s.watermark, kokeYol: kokeYol(p, i) })),
      ...(p.markedBy ?? []).map((m) => ({ tablo: m.table, filigran: "isaret" as const, kokeYol: `tetikleyici ${m.trigger}` })),
    ],
    silme: p.deletion,
    izin: p.permission,
    ...(p.module ? { modul: p.module } : {}),
  };
}

export const KAYIT_PROJEKSIYONLARI: readonly KayitProjeksiyonu[] = RECORD_PROJECTIONS.map(kayit);

export const PROJEKSIYONLAR: readonly Projeksiyon[] = [
  ...KAYIT_PROJEKSIYONLARI,
  ...SNAPSHOT_PROJECTIONS.map((s): AnlikProjeksiyon => ({
    ad: s.name,
    tur: "ANLIK",
    kaynak: s.source,
    siklik: s.cadence,
    izin: s.permission,
    ...(s.module ? { modul: s.module } : {}),
    okudugu: [...s.reads],
  })),
];

export const YARDIMCI_OKUMALAR: ReadonlyArray<{ tablo: string; filigran: string; neden: string }> = SYNC_AUX_READS.map((a) => ({
  tablo: a.table,
  filigran: a.watermark,
  neden: a.why,
}));

export const BILINCLI_DISARIDA: Readonly<Record<string, string>> = DELIBERATELY_EXCLUDED;
