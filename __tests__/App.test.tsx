/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('react-native-mmkv', () => {
  const storage = new Map<string, string>();

  return {
    createMMKV: () => ({
      set: (key: string, value: string) => storage.set(key, value),
      getString: (key: string) => storage.get(key),
      remove: (key: string) => storage.delete(key),
      clearAll: () => storage.clear(),
    }),
  };
});

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
