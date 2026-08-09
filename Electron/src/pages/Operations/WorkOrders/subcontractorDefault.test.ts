import { describe, it, expect } from "vitest";
import { pickDefaultFirmId } from "./useDesignerSteps";

// =============================================================================
// Test: fason firma VARSAYILANI — kişisel tercih (2026-08-09)
// =============================================================================
// Saha isteği: *"iş emri oluştururken son seçilen fasoncu otomatik gelsin;
// favori geliyor şu an da."* Kullanıcı kararı: açılır-kapanır KİŞİSEL tercih.
//
// Bu bekçinin kilitlediği iki şey:
//   ① VARSAYILAN "favorite" — yani BUGÜNKÜ davranış. Yeni davranışı varsayılan
//      yapmak sahadaki herkesin alışkanlığını habersiz değiştirirdi.
//   ② `lastUsed` seçiliyken GEÇMİŞ YOKSA favoriye düşülür. Boş bırakmak, yeni
//      bir kategoride tercihi açan kullanıcıya "hiçbir şey gelmiyor" dedirtirdi.
// =============================================================================

const CAT = "cat-boyahane";
const OTHER = "cat-zimpara";

const favs = [
  { id: "firm-fav", isFavorite: true, categories: [{ categoryId: CAT }] },
  { id: "firm-other", isFavorite: false, categories: [{ categoryId: CAT }] },
  { id: "firm-fav2", isFavorite: true, categories: [{ categoryId: OTHER }] },
];

describe("fason firma varsayılanı", () => {
  it("⭐ tercih verilmezse FAVORİ gelir (bugünkü davranış korunur)", () => {
    expect(pickDefaultFirmId(undefined, favs, undefined, CAT)).toBe("firm-fav");
  });

  it('"favorite" seçiliyken geçmiş VAR olsa bile favori gelir', () => {
    expect(pickDefaultFirmId("favorite", favs, { [CAT]: "firm-other" }, CAT)).toBe("firm-fav");
  });

  it('"lastUsed" seçiliyken geçmiş kazanır', () => {
    expect(pickDefaultFirmId("lastUsed", favs, { [CAT]: "firm-other" }, CAT)).toBe("firm-other");
  });

  it('⭐ "lastUsed" ama o kategoride geçmiş YOKSA favoriye düşer', () => {
    expect(pickDefaultFirmId("lastUsed", favs, { [OTHER]: "firm-fav2" }, CAT)).toBe("firm-fav");
    expect(pickDefaultFirmId("lastUsed", favs, {}, CAT)).toBe("firm-fav");
    expect(pickDefaultFirmId("lastUsed", favs, undefined, CAT)).toBe("firm-fav");
  });

  it("geçmiş KATEGORİ BAZINDA tutulur (kategoriler karışmaz)", () => {
    const last = { [CAT]: "firm-other", [OTHER]: "firm-x" };
    expect(pickDefaultFirmId("lastUsed", favs, last, CAT)).toBe("firm-other");
    expect(pickDefaultFirmId("lastUsed", favs, last, OTHER)).toBe("firm-x");
  });

  it("ne favori ne geçmiş varsa null (boş bırakılır, uydurulmaz)", () => {
    expect(pickDefaultFirmId("lastUsed", [], undefined, "cat-yok")).toBeNull();
    expect(pickDefaultFirmId("favorite", [], undefined, "cat-yok")).toBeNull();
  });

  it("favori BAŞKA kategoriye aitse seçilmez", () => {
    // firm-fav2 favori ama OTHER kategorisinde — CAT için gelmemeli.
    expect(pickDefaultFirmId("favorite", [favs[2]!], undefined, CAT)).toBeNull();
  });
});
