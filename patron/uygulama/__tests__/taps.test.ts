jest.mock("expo-notifications", () => ({ setNotificationHandler: jest.fn() }));
jest.mock("../src/state/session", () => ({ useSession: () => ({}) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const { openNotification } = require("../src/push/taps") as typeof import("../src/push/taps");

function deps(facilityId: string | null, switchOk = true) {
  const order: string[] = [];
  return {
    order,
    d: {
      facilityId,
      switchFacility: jest.fn(async (id: string) => { order.push(`gecis:${id}`); return switchOk; }),
      push: jest.fn((r: string) => void order.push(`rota:${r}`)),
    },
  };
}

describe("bildirim dokunuşu (çok tesis)", () => {
  it("farklı tesisId → önce geçiş, sonra rota", async () => {
    const { order, d } = deps("t1");
    await expect(openNotification({ rota: "/siparisler", tesisId: "t2" }, d)).resolves.toBe(true);
    expect(order).toEqual(["gecis:t2", "rota:/siparisler"]);
  });
  it("aynı tesis ya da tesisId yok (eski yük) → geçiş yok, rota açılır", async () => {
    for (const data of [{ rota: "/stok", tesisId: "t1" }, { rota: "/stok" }]) {
      const { order, d } = deps("t1");
      await openNotification(data, d);
      expect(order).toEqual(["rota:/stok"]);
    }
  });
  it("geçiş reddedilirse rota AÇILMAZ", async () => {
    const { order, d } = deps("t1", false);
    await expect(openNotification({ rota: "/finans", tesisId: "t9" }, d)).resolves.toBe(false);
    expect(order).toEqual(["gecis:t9"]);
  });
  it("güvensiz rota → ne geçiş ne rota", async () => {
    const { order, d } = deps("t1");
    await expect(openNotification({ rota: "https://kotu.ornek", tesisId: "t2" }, d)).resolves.toBe(false);
    expect(order).toEqual([]);
  });
});
