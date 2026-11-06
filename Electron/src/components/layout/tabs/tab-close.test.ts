import { describe, expect, it } from "vitest";
import { idsToClose, isCloseAllShortcut, nextActiveAfterClose } from "./tab-close";

const T = ["a", "b", "c", "d"].map((id) => ({ id }));

describe("idsToClose", () => {
  it("kapsamları şerit sırasıyla verir", () => {
    expect(idsToClose(T, "b", "self")).toEqual(["b"]);
    expect(idsToClose(T, "b", "others")).toEqual(["a", "c", "d"]);
    expect(idsToClose(T, "b", "right")).toEqual(["c", "d"]);
    expect(idsToClose(T, "b", "left")).toEqual(["a"]);
    expect(idsToClose(T, null, "all")).toEqual(["a", "b", "c", "d"]);
  });

  it("uçtaki sekmede geçersiz kapsam boştur (menüde pasif)", () => {
    expect(idsToClose(T, "d", "right")).toEqual([]);
    expect(idsToClose(T, "a", "left")).toEqual([]);
    expect(idsToClose([{ id: "x" }], "x", "others")).toEqual([]);
    expect(idsToClose([], null, "all")).toEqual([]);
  });

  it("bilinmeyen çapa hiçbir şey kapatmaz (fail-closed)", () => {
    for (const s of ["self", "others", "right", "left"] as const) expect(idsToClose(T, "zz", s)).toEqual([]);
  });
});

describe("nextActiveAfterClose", () => {
  it("etkin kaldıysa yerinde durur", () => {
    expect(nextActiveAfterClose(T, "b", new Set(["c", "d"]))).toBe("b");
  });
  it("etkin kapandıysa önce sağdaki ilk kalan", () => {
    expect(nextActiveAfterClose(T, "b", new Set(["b"]))).toBe("c");
    expect(nextActiveAfterClose(T, "b", new Set(["b", "c"]))).toBe("d");
  });
  it("sağda kalan yoksa soldaki en yakın", () => {
    expect(nextActiveAfterClose(T, "d", new Set(["d"]))).toBe("c");
    expect(nextActiveAfterClose(T, "c", new Set(["c", "d"]))).toBe("b");
  });
  it("hepsi kapandıysa null", () => {
    expect(nextActiveAfterClose(T, "b", new Set(["a", "b", "c", "d"]))).toBeNull();
  });
});

describe("isCloseAllShortcut", () => {
  const k = { ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: "W" };
  it("Ctrl+Shift+W eşleşir", () => expect(isCloseAllShortcut(k)).toBe(true));
  it("Cmd+Shift+W (macOS pencere kapatma) ve Ctrl+W eşleşmez", () => {
    expect(isCloseAllShortcut({ ...k, ctrlKey: false, metaKey: true })).toBe(false);
    expect(isCloseAllShortcut({ ...k, shiftKey: false, key: "w" })).toBe(false);
  });
});
