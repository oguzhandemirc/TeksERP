import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInfiniteScroll } from "./useInfiniteScroll";

// Test-local IntersectionObserver mock — gerçek gözlemci yerine callback'i yakalar
// ki sentinel'i "görünür oldu" diye elle tetikleyebilelim (jsdom IO sağlamaz).
interface MockIOInstance {
  cb: IntersectionObserverCallback;
  trigger: (isIntersecting: boolean) => void;
  disconnect: ReturnType<typeof vi.fn>;
  observed: Element[];
}
let ioInstances: MockIOInstance[] = [];

class MockIO {
  cb: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = () => [] as IntersectionObserverEntry[];
  root = null;
  rootMargin = "";
  thresholds: number[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    ioInstances.push({
      cb,
      disconnect: this.disconnect,
      observed: this.observed,
      trigger: (isIntersecting: boolean) =>
        cb([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver),
    });
  }
  observe(el: Element) {
    this.observed.push(el);
  }
}

function Harness(props: Parameters<typeof useInfiniteScroll>[0]) {
  const { rootRef, sentinelRef } = useInfiniteScroll(props);
  return (
    <div ref={rootRef}>
      <div ref={sentinelRef} data-testid="sentinel" />
    </div>
  );
}

beforeEach(() => {
  ioInstances = [];
  vi.stubGlobal("IntersectionObserver", MockIO);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useInfiniteScroll — kısa liste koruması (jsdom scrollHeight=clientHeight=0)", () => {
  it("mount'ta yüklenecek varsa ve boştaysa onLoadMore çağırır", () => {
    const onLoadMore = vi.fn();
    render(<Harness hasMore isLoading={false} onLoadMore={onLoadMore} />);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("bir fetch sürerken (isLoading) yüklemez", () => {
    const onLoadMore = vi.fn();
    render(<Harness hasMore isLoading onLoadMore={onLoadMore} />);
    ioInstances.at(-1)?.trigger(true);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("başka sayfa yoksa (hasMore=false) yüklemez", () => {
    const onLoadMore = vi.fn();
    render(<Harness hasMore={false} isLoading={false} onLoadMore={onLoadMore} />);
    ioInstances.at(-1)?.trigger(true);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("enabled=false iken yüklemez", () => {
    const onLoadMore = vi.fn();
    render(<Harness hasMore isLoading={false} onLoadMore={onLoadMore} enabled={false} />);
    ioInstances.at(-1)?.trigger(true);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("unmount'ta observer disconnect edilir", () => {
    const { unmount } = render(<Harness hasMore isLoading={false} onLoadMore={vi.fn()} />);
    const io = ioInstances.at(-1);
    unmount();
    expect(io?.disconnect).toHaveBeenCalled();
  });
});

describe("useInfiniteScroll — sentinel görünürlüğü (uzun liste, guard bastırılmış)", () => {
  // Kapsayıcı içeriği doldurdu → guard tetiklenmez; yalnız IntersectionObserver
  // sentinel görünür olunca yükler.
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  });
  afterEach(() => {
    // @ts-expect-error test cleanup — prototip getter'ı kaldır
    delete HTMLElement.prototype.scrollHeight;
    // @ts-expect-error test cleanup
    delete HTMLElement.prototype.clientHeight;
  });

  it("dolu kapsayıcıda mount'ta kendiliğinden yüklemez", () => {
    const onLoadMore = vi.fn();
    render(<Harness hasMore isLoading={false} onLoadMore={onLoadMore} />);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("sentinel görünür olunca (isIntersecting=true) yükler", () => {
    const onLoadMore = vi.fn();
    render(<Harness hasMore isLoading={false} onLoadMore={onLoadMore} />);
    ioInstances.at(-1)?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("sentinel görünür değilken (isIntersecting=false) yüklemez", () => {
    const onLoadMore = vi.fn();
    render(<Harness hasMore isLoading={false} onLoadMore={onLoadMore} />);
    ioInstances.at(-1)?.trigger(false);
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
