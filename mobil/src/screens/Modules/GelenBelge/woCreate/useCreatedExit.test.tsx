import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreatedExit } from './useCreatedExit';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const run = (done: boolean, own: boolean, draft: boolean, cb?: () => void) => {
  const qc = new QueryClient();
  const spy = jest.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const h = renderHook((p: { d: boolean }) => useCreatedExit(p.d, own, draft, cb), { wrapper, initialProps: { d: done } });
  return { h, spy };
};

describe('useCreatedExit', () => {
  it('İE oluşunca listeyi tazeler ve bir kez çıkar', () => {
    const cb = jest.fn();
    const { h, spy } = run(false, false, false, cb);
    expect(cb).not.toHaveBeenCalled();
    h.rerender({ d: true });
    h.rerender({ d: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-orders', 'is-emirleri'] });
  });
  it('taslak kaydında ve çıkış verilmemişse çıkmaz', () => {
    const cb = jest.fn();
    run(true, false, true, cb);
    run(true, false, false, undefined);
    expect(cb).not.toHaveBeenCalled();
  });
});
