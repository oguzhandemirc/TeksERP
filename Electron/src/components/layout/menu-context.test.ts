import { beforeEach, describe, expect, it } from "vitest";
import {
  bindPendingMenuClick,
  effectiveMenuContext,
  groupOwner,
  menuBreadcrumbParent,
  recordMenuClick,
  resolveMenuPlacement,
  useMenuContextStore,
  type MenuPlacement,
} from "./menu-context";
import { menuPlacements } from "./use-menu-placement";
import type { NavGroup } from "./nav-config";

/**
 * Menü bağlamı: aynı ekran iki kökte (Fasondaki İplik: Depo + Üretim). Etkin konum tıklanan yerde kalır;
 * bağlamsız açılışta ekranın kendi kökü; her sekme kendi bağlamını hatırlar.
 */
const FI = "/operations/fasondaki-iplik";
const GENEL = groupOwner("Genel");
const icon = () => null;

const groups: NavGroup[] = [
  {
    label: "Genel",
    items: [
      { label: "Depo", to: "/warehouse", icon, children: [
        { label: "İplik Stoğu", to: "/operations/yarn-stock", icon },
        { label: "Fasondaki İplik", to: FI, icon, crossListed: true },
      ] },
      { label: "Üretim", to: "/production", icon, children: [
        { label: "Fasondaki İplik", to: FI, icon },
        { label: "İş Emirleri", to: "/operations/work-orders", icon },
        { label: "Yeni İş Emri", to: "/operations/work-orders/new", icon },
        { label: "Denye Sapma", to: "/reports/dokuma/denye-sapma", icon },
      ] },
      { label: "Raporlar", to: "/reports", icon },
      { label: "Kalite", to: "/quality", icon, children: [
        { label: "Muayeneler", to: "/quality/inspections", icon },
        { label: "Muayene Raporu", to: "/quality/inspections?report=1", icon },
      ] },
    ],
  },
  { label: "Favoriler", items: [{ label: "Fasondaki İplik", to: FI, icon }] },
] as never;

const P = menuPlacements(groups);
const DEPO_FI: MenuPlacement = { owner: "/warehouse", to: FI };
const URETIM_FI: MenuPlacement = { owner: "/production", to: FI };

describe("resolveMenuPlacement", () => {
  it("⭐ tıklanan bağlam kazanır: Üretim'den açılan Fasondaki İplik Üretim'de kalır", () => {
    expect(resolveMenuPlacement(P, FI, URETIM_FI)).toEqual(URETIM_FI);
    expect(resolveMenuPlacement(P, FI, DEPO_FI)).toEqual(DEPO_FI);
    expect(resolveMenuPlacement(P, FI, { owner: groupOwner("Favoriler"), to: FI })).toEqual({ owner: groupOwner("Favoriler"), to: FI });
  });

  it("⭐ bağlamsız adres (komut paleti, F5 kaydı yok) ekranın kendi kökünde: çapraz liste ve Favoriler sonra", () => {
    expect(resolveMenuPlacement(P, FI, null)).toEqual(URETIM_FI);
  });

  it("alt sayfa (detay) bağlamı korur", () => {
    expect(resolveMenuPlacement(P, `${FI}/123`, DEPO_FI)).toEqual(DEPO_FI);
    expect(resolveMenuPlacement(P, `${FI}/123`, null)).toEqual(URETIM_FI);
  });

  it("aynı kökte daha özgül ekran kazanır (liste → Yeni)", () => {
    const ctx = { owner: "/production", to: "/operations/work-orders" };
    expect(resolveMenuPlacement(P, "/operations/work-orders/new", ctx)).toEqual({ owner: "/production", to: "/operations/work-orders/new" });
    expect(resolveMenuPlacement(P, "/operations/work-orders/9", ctx)).toEqual(ctx);
  });

  it("Raporlar'dan açılan rapor, Üretim'de de dursa Raporlar'da kalır", () => {
    const ctx = { owner: GENEL, to: "/reports" };
    expect(resolveMenuPlacement(P, "/reports/dokuma/denye-sapma", ctx)).toEqual(ctx);
    expect(resolveMenuPlacement(P, "/reports/dokuma/denye-sapma", null)).toEqual({ owner: "/production", to: "/reports/dokuma/denye-sapma" });
  });

  it("bölüm kökünden karta inilince o kökün kopyası yanar", () => {
    expect(resolveMenuPlacement(P, FI, { owner: GENEL, to: "/warehouse" })).toEqual(DEPO_FI);
    expect(resolveMenuPlacement(P, FI, { owner: GENEL, to: "/production" })).toEqual(URETIM_FI);
  });

  it("sayfa içi gezinme başka ekrana: bağlam düşer, tek konum yanar", () => {
    expect(resolveMenuPlacement(P, "/operations/yarn-stock", URETIM_FI)).toEqual({ owner: "/warehouse", to: "/operations/yarn-stock" });
    expect(resolveMenuPlacement(P, "/operations/rolls", URETIM_FI)).toBeNull();
    expect(resolveMenuPlacement(P, null, URETIM_FI)).toBeNull();
  });

  it("sorgulu konum: bağlam aynı yoldaki iki satırdan tıklananı seçer", () => {
    const report = { owner: "/quality", to: "/quality/inspections?report=1" };
    expect(resolveMenuPlacement(P, "/quality/inspections", report)).toEqual(report);
    expect(resolveMenuPlacement(P, "/quality/inspections", null)).toEqual({ owner: "/quality", to: "/quality/inspections" });
  });

  it("`/` yalnız tam eşleşir", () => {
    const root = [{ owner: GENEL, to: "/" }];
    expect(resolveMenuPlacement(root, "/sales", null)).toBeNull();
    expect(resolveMenuPlacement(root, "/", null)).toEqual(root[0]);
  });
});

describe("sekme bağlamı", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useMenuContextStore.setState({ byTab: {}, pending: null });
  });

  it("⭐ her sekme kendi bağlamını hatırlar; sekme değişince etkin konum o sekmeninki", () => {
    recordMenuClick({ ...URETIM_FI, ownerLabel: "Üretim" });
    bindPendingMenuClick("t1", FI, ["t1", "t2"]);
    recordMenuClick({ ...DEPO_FI, ownerLabel: "Depo" });
    bindPendingMenuClick("t2", FI, ["t1", "t2"]);
    const s = useMenuContextStore.getState();
    expect(resolveMenuPlacement(P, FI, effectiveMenuContext(s, "t1", FI))).toEqual(URETIM_FI);
    expect(resolveMenuPlacement(P, FI, effectiveMenuContext(s, "t2", FI))).toEqual(DEPO_FI);
    expect(effectiveMenuContext(s, "t3", FI)).toBeNull();
  });

  it("bağlanmamış tık aynı olayda okunur (titreme yok); gezinme olmadıysa düşer", () => {
    recordMenuClick(URETIM_FI);
    expect(effectiveMenuContext(useMenuContextStore.getState(), "t1", FI)).toEqual(URETIM_FI);
    bindPendingMenuClick("t1", "/operations/rolls");
    expect(useMenuContextStore.getState()).toMatchObject({ pending: null, byTab: {} });
  });

  it("F5: bağlam sessionStorage'a yazılır; kapanan sekmenin kaydı budanır", () => {
    useMenuContextStore.setState({ byTab: { eski: DEPO_FI } });
    recordMenuClick(URETIM_FI);
    bindPendingMenuClick("t1", FI, ["t1"]);
    expect(JSON.parse(sessionStorage.getItem("tekserp.nav.tabMenuContext")!)).toEqual({ t1: URETIM_FI });
  });

  it("kırıntı tıklanan köke uyar; üst satır tıkı ve başka ekran katalog üstüne bırakır", () => {
    expect(menuBreadcrumbParent({ ...URETIM_FI, ownerLabel: "Üretim" }, FI)).toEqual({ label: "Üretim", to: "/production" });
    expect(menuBreadcrumbParent({ ...URETIM_FI, ownerLabel: "Üretim" }, "/operations/rolls")).toBeNull();
    expect(menuBreadcrumbParent({ owner: GENEL, to: "/reports" }, "/reports")).toBeNull();
    expect(menuBreadcrumbParent(null, FI)).toBeNull();
  });
});
