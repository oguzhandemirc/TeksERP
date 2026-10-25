import { describe, expect, it } from "vitest";
import { diffStats, foldUnchanged, lineDiff } from "./lineDiff";

const kinds = (a: string, b: string, limit?: number) => lineDiff(a, b, limit).map((l) => `${l.kind[0]}:${l.text}`);

describe("lineDiff (kendi LCS'imiz)", () => {
  it("aynı metin → hepsi same, satır noları eş", () => {
    const d = lineDiff("a\nb", "a\nb");
    expect(d.every((l) => l.kind === "same")).toBe(true);
    expect(d.map((l) => [l.oldNo, l.newNo])).toEqual([[1, 1], [2, 2]]);
  });
  it("ortada değişen satır", () => {
    expect(kinds("a\nb\nc", "a\nX\nc")).toEqual(["s:a", "d:b", "a:X", "s:c"]);
  });
  it("ekleme ve silme satır noları", () => {
    const d = lineDiff("a\nc", "a\nb\nc");
    expect(d.find((l) => l.kind === "add")).toMatchObject({ text: "b", oldNo: null, newNo: 2 });
    expect(diffStats(lineDiff("a\nb\nc", "c"))).toEqual({ added: 0, removed: 2 });
  });
  it("LCS en uzun ortak alt diziyi korur (yer değiştirme)", () => {
    expect(diffStats(lineDiff("x\na\nb\nc", "a\nb\nc\nx"))).toEqual({ added: 1, removed: 1 });
  });
  it("boş metinler ve CRLF", () => {
    expect(lineDiff("", "")).toEqual([]);
    expect(kinds("", "a")).toEqual(["a:a"]);
    expect(kinds("a\r\nb", "a\nb")).toEqual(["s:a", "s:b"]);
  });
  it("tablo sınırı aşılınca çekirdek kaba fark (baş/son korunur)", () => {
    expect(kinds("h\n1\n2\nt", "h\n3\n4\nt", 4)).toEqual(["s:h", "d:1", "d:2", "a:3", "a:4", "s:t"]);
  });
  it("katlama değişiklik çevresinde bağlam bırakır", () => {
    const old = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const neu = old.replace("l10", "L10");
    const f = foldUnchanged(lineDiff(old, neu), 2);
    expect(f[0]).toEqual({ kind: "fold", count: 8 });
    expect(f.at(-1)).toEqual({ kind: "fold", count: 7 });
  });
});
