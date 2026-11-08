// Boş/hata ekranında aşağı çekme: RefreshControl.onRefresh çağrısı callback'i tetikler.
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import PullToRefreshView from './PullToRefreshView';

it('refreshControl onRefresh callback tetikler', () => {
  const onRefresh = jest.fn();
  const { getByTestId } = render(
    <PullToRefreshView refreshing={false} onRefresh={onRefresh} testID="ptr"><Text>bos</Text></PullToRefreshView>,
  );
  getByTestId('ptr').props.refreshControl.props.onRefresh();
  expect(onRefresh).toHaveBeenCalledTimes(1);
});
