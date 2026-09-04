// =============================================================================
// Bekçi: ÇUVAL İZİ — liste yüzeyi + toplu hamle (2026-09-04)
//   §1 ÜÇ DURUMLU kutucuk: "hepsinde / bazısında / hiçbirinde" ayrı ayrı
//      ölçülür ve niyet döngüsü "dokunmadım"a GERİ DÖNEBİLİR.
//      ⭐ NEGATİF SONDA: iki durumlu bir kutucuk (some → all/none'a katlanmış)
//      "kaldırdım" ile "dokunmadım"ı ayırt ettiremez.
//   §2 Gövde kurucusu: `removeAll` + `remove` ASLA birlikte gitmez (sunucu 400
//      verir); niyet yoksa `null` (boş gövde 400 üretirdi).
//   §3 ⭐ `skipped` SESSİZCE YUTULMAZ — özet uyarı tonuna geçer ve gerekçe
//      metne girer.
//   §4 Süzgeç SENTİNELİ: "izsiz" değeri backend aynasıyla birebir ve `tagId`
//      filtresi `multi-lookup` + sentinel olarak KURULU (metin tarar).
//   §5 `sortBy=tag` EKLENMEMİŞ — kolon sıralanabilir başlık taşımaz.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBulkPayload,
  checkboxView,
  nextIntent,
  summarizeBulkResult,
  tagTriState,
  type TagIntent,
} from "./sackTagBulk";
import { UNTAGGED_FILTER_VALUE } from "./types";
import type { SackSearchRow } from "./types";

const listSource = readFileSync(resolve(__dirname, "./SacksListView.tsx"), "utf-8");
const colSource = readFileSync(resolve(__dirname, "./sacksColumns.tsx"), "utf-8");
const pickSource = readFileSync(resolve(__dirname, "./PickListPrintDialog.tsx"), "utf-8");
const menuSource = readFileSync(resolve(__dirname, "./SackTagsBulkMenu.tsx"), "utf-8");

const tag = (id: string) => ({ id, code: id.toUpperCase(), name: id, hex: "#DC2626", isActive: true });
const row = (id: string, tagIds: string[]): SackSearchRow =>
  ({ id, tags: tagIds.map(tag), hasTag: tagIds.length > 0 }) as unknown as SackSearchRow;

describe("§1 üç durumlu kutucuk", () => {
  const rows = [row("s1", ["kontrol"]), row("s2", ["kontrol", "eksik"]), row("s3", [])];

  it("durum: hepsinde / bazısında / hiçbirinde", () => {
    expect(tagTriState([rows[0]!, rows[1]!], "kontrol")).toBe("all");
    expect(tagTriState(rows, "kontrol")).toBe("some");
    expect(tagTriState(rows, "yok")).toBe("none");
    // Seçim boşken hiçbir şey işaretli görünmez.
    expect(tagTriState([], "kontrol")).toBe("none");
  });

  it("⭐ 'bazısında' AYRI çizilir — 'hepsinde' ile aynı görünüm değil", () => {
    // Negatif sondanın kilidi: `some` durumu indeterminate basmalı. İki durumlu
    // bir uygulamada burası `checked:false` olur ve "hiçbirinde" ile karışır.
    expect(checkboxView("some", "keep")).toEqual({ checked: false, indeterminate: true, changed: false });
    expect(checkboxView("all", "keep")).toEqual({ checked: true, indeterminate: false, changed: false });
    expect(checkboxView("none", "keep")).toEqual({ checked: false, indeterminate: false, changed: false });
  });

  it("⭐ 'kaldırdım' ile 'dokunmadım' AYIRT EDİLİR", () => {
    const dokunmadim = checkboxView("all", "keep");
    const kaldirdim = checkboxView("all", "remove");
    // İkisi de sonuçta farklı davranır → görünümleri de farklı olmalı.
    expect(kaldirdim.changed).toBe(true);
    expect(dokunmadim.changed).toBe(false);
    expect(kaldirdim.checked).not.toBe(dokunmadim.checked);
  });

  it("niyet döngüsü duruma göre değişir ve 'dokunmadım'a DÖNER", () => {
    expect(nextIntent("all", "keep")).toBe("remove");
    expect(nextIntent("all", "remove")).toBe("keep");
    expect(nextIntent("none", "keep")).toBe("add");
    expect(nextIntent("none", "add")).toBe("keep");
    // "bazısında": önce hepsine ekle → hepsinden kaldır → dokunma
    expect(nextIntent("some", "keep")).toBe("add");
    expect(nextIntent("some", "add")).toBe("remove");
    expect(nextIntent("some", "remove")).toBe("keep");
  });

  it("döngü SONLU — her durumda en fazla 3 adımda başa döner", () => {
    for (const state of ["all", "some", "none"] as const) {
      let cur: TagIntent = "keep";
      const seen = new Set<TagIntent>();
      for (let i = 0; i < 4; i++) {
        cur = nextIntent(state, cur);
        seen.add(cur);
      }
      expect(seen.has("keep")).toBe(true);
    }
  });
});

describe("§2 gövde kurucusu", () => {
  it("⭐ removeAll ile remove ASLA birlikte gitmez (sunucu 400 verir)", () => {
    const p = buildBulkPayload(["s1"], { a: "remove", b: "add" }, true);
    expect(p).not.toBeNull();
    expect(p!.removeAll).toBe(true);
    expect(p!.remove).toBeUndefined();
    // Ekleme niyeti KORUNUR — "temizle, sonra şunu bırak" tek meşru hamledir.
    expect(p!.add).toEqual(["b"]);
  });

  it("niyet yoksa null (boş gövde göndermek 400 üretirdi)", () => {
    expect(buildBulkPayload(["s1"], {}, false)).toBeNull();
    expect(buildBulkPayload(["s1"], { a: "keep" }, false)).toBeNull();
    // Çuval seçilmemişse de gönderilmez.
    expect(buildBulkPayload([], { a: "add" }, false)).toBeNull();
  });

  it("ekleme + kaldırma AYNI çağrıda serbest (yeniden etiketleme tek hamle)", () => {
    const p = buildBulkPayload(["s1", "s2"], { a: "add", b: "remove", c: "keep" }, false);
    expect(p).toEqual({ sackIds: ["s1", "s2"], add: ["a"], remove: ["b"] });
  });
});

describe("§3 kısmi sonuç", () => {
  it("temiz sonuç → başarı", () => {
    const s = summarizeBulkResult({ added: 3, removed: 0, skipped: [] });
    expect(s.tone).toBe("success");
    expect(s.title).toContain("3 iz bırakıldı");
  });

  it("⭐ atlanan çuval SESSİZCE YUTULMAZ", () => {
    const s = summarizeBulkResult({
      added: 9,
      removed: 0,
      skipped: [
        { sackId: "x", reason: "CV1 sevk edilmiş — atlandı" },
        { sackId: "y", reason: "CV2 sevk edilmiş — atlandı" },
      ],
    });
    expect(s.tone).toBe("warning");
    expect(s.description).toContain("2 çuval atlandı");
    expect(s.description).toContain("CV1 sevk edilmiş");
  });

  it("çok sayıda atlananda ilk 3 + kalan sayısı basılır (mesaj taşmasın)", () => {
    const s = summarizeBulkResult({
      added: 0,
      removed: 0,
      skipped: Array.from({ length: 7 }, (_, i) => ({ sackId: `s${i}`, reason: `CV${i} atlandı` })),
    });
    expect(s.description).toContain("+4 çuval");
  });

  it("popover atlananları TOAST'a taşır (uyarı yolu bağlı)", () => {
    expect(menuSource).toContain("summarizeBulkResult");
    expect(menuSource).toMatch(/toast\.warning/);
    // İş bitince seçim temizlenir (çağırana bildirilir).
    expect(menuSource).toContain("onDone()");
    expect(listSource).toContain("table.resetRowSelection()");
  });
});

describe("§4 süzgeç sentineli", () => {
  it("değer backend aynasıyla birebir", () => {
    expect(UNTAGGED_FILTER_VALUE).toBe("none");
  });

  it("⭐ 'İz' süzgeci multi-lookup + sentinelOption olarak KURULU", () => {
    // Filtre tanımı düşerse ya da sentinel unutulursa "izsiz çuvallar" kümesi
    // hiçbir yüzeyden süzülemez (müşterisiz kovasının aynı dersi).
    expect(listSource).toMatch(/key:\s*"tagId"/);
    expect(listSource).toContain("sackTagService");
    expect(listSource).toContain("UNTAGGED_FILTER_VALUE");
    expect(listSource).toMatch(/sentinelOption:\s*\{\s*value:\s*UNTAGGED_FILTER_VALUE/);
  });

  it("çoklu seçim VEYA semantiği EKRANDA yazılı", () => {
    expect(listSource).toContain("İz (VEYA)");
  });
});

describe("§5 sıralama sözleşmesi + rozet", () => {
  it("⭐ `sortBy=tag` EKLENMEMİŞ (cursor'lu sıralama ilişkiyle bozulur)", () => {
    const tagsCol = colSource.slice(colSource.indexOf('id: "tags"'));
    const nextCol = tagsCol.indexOf('accessorKey: "createdAt"');
    expect(tagsCol.slice(0, nextCol)).not.toContain("SortableHeader");
    expect(colSource).not.toContain('field="tag"');
  });

  it("pasif etiket rozeti GÖSTERİLİR (soluk) — geçmiş silinmez", () => {
    expect(colSource).toContain("!t.isActive");
    expect(colSource).toContain("opacity-50");
  });

  it("çeki listesinde iz AYRI kutucuk — withNotes'a bindirilmemiş", () => {
    expect(pickSource).toContain("withTags");
    expect(pickSource).toMatch(/const \[withTags, setWithTags\] = useState\(false\)/);
    // Aynı koşulda iki veri basılıyorsa bindirme yapılmış demektir.
    expect(pickSource).not.toMatch(/withNotes\s*&&\s*\(?r\.tags/);
  });
});
