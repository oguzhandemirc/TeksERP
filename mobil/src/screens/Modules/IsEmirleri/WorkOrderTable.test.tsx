// İE listesi okutmadan dönünce yeni İE tepede görünür (prova 2026-11-06): sorgu yeniden çekiyordu, ama FlashList v2'nin
// varsayılan "görünür içeriğe tutunma"sı başa eklenen satırı görüş alanının üstüne itiyordu. Bu dosya iki ayağı da kilitler.
import React, { useState } from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkOrderTable, { NEWEST_FIRST_LIST } from './WorkOrderTable';
import { useWorkOrderList } from './useWorkOrderList';
import { DEFAULT_FILTERS, type WorkOrderListRow } from './workOrderRow';
import { DEFAULT_VISIBLE } from './columns';

const mockFlashProps: Record<string, unknown>[] = [];
jest.mock('@shopify/flash-list', () => {
  const { View } = jest.requireActual('react-native');
  return {
    FlashList: (props: { data: unknown[]; renderItem: (a: { item: unknown; index: number }) => React.ReactNode }) => {
      mockFlashProps.push(props as unknown as Record<string, unknown>);
      return <View>{props.data.map((item, index) => <View key={index}>{props.renderItem({ item, index })}</View>)}</View>;
    },
  };
});
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => undefined }));

let mockServerRows = 1;
jest.mock('../../../services/workOrder.service', () => ({
  workOrderService: {
    getAllCursor: jest.fn(async () => ({
      // Sunucu en yeniyi üstte döner: yeni İE dizinin BAŞINA girer.
      data: Array.from({ length: mockServerRows }, (_, i) => ({ id: `wo${mockServerRows - i}`, workOrderNumber: `IE${mockServerRows - i}`, status: 'PLANNED', createdAt: '2026-11-06T13:00:00Z' })),
      pagination: { hasMore: false, nextCursor: null, totalEstimate: mockServerRows },
    })),
  },
}));

const row = (id: string): WorkOrderListRow => ({ id, workOrderNumber: id.toUpperCase(), status: 'PLANNED', createdAt: '2026-11-06T13:00:00Z' });
const tableProps = (rows: WorkOrderListRow[]) => ({
  rows,
  visible: [...DEFAULT_VISIBLE],
  loading: false,
  problem: null,
  empty: { title: '', text: '', action: null },
  refreshing: false,
  fetchingMore: false,
  onEndReached: jest.fn(),
  onRefresh: jest.fn(),
  onRetry: jest.fn(),
  onOpen: jest.fn(),
  onEmptyAction: jest.fn(),
});

beforeEach(() => {
  mockFlashProps.length = 0;
  mockServerRows = 1;
});

describe('WorkOrderTable — en yeni üstte', () => {
  it('FlashList görünür içeriğe TUTUNMAZ (başa eklenen İE görüş alanının üstüne itilmez)', () => {
    render(<WorkOrderTable {...tableProps([row('wo2'), row('wo1')])} />);
    const last = mockFlashProps[mockFlashProps.length - 1];
    expect(last.maintainVisibleContentPosition).toBe(NEWEST_FIRST_LIST);
    expect(NEWEST_FIRST_LIST.disabled).toBe(true);
  });
});

describe('İE listesi — okutmadan dönüş', () => {
  let api: { openScan: () => void; back: () => void } | null = null;
  function Harness() {
    // IsEmirleriScreen kabuğunun aynısı: liste hook'u okutma sahnesinde de bağlı kalır, geri → refreshAll.
    const [scan, setScan] = useState(false);
    const list = useWorkOrderList(DEFAULT_FILTERS);
    api = { openScan: () => setScan(true), back: () => { setScan(false); void list.refreshAll(); } };
    if (scan) return <Text>okutma</Text>;
    return <WorkOrderTable {...tableProps(list.rows)} />;
  }

  it('geri dönünce liste yeniden çekilir ve yeni İE ilk satırdır', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 0 } } });
    const r = render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>);
    await waitFor(() => expect(r.getByTestId('ie-satir-wo1')).toBeTruthy());
    act(() => api!.openScan());
    mockServerRows = 2; // okutmada İE açıldı
    act(() => api!.back());
    await waitFor(() => expect(r.getByTestId('ie-satir-wo2')).toBeTruthy());
    const ids = r.getAllByTestId(/^ie-satir-/).map((n) => n.props.testID);
    expect(ids).toEqual(['ie-satir-wo2', 'ie-satir-wo1']);
    const last = mockFlashProps[mockFlashProps.length - 1];
    expect((last.maintainVisibleContentPosition as { disabled?: boolean }).disabled).toBe(true);
    qc.clear();
  });
});
