import { NativeModules } from 'react-native';
import { createMMKV, type MMKV } from 'react-native-mmkv';
import { StorageKeys } from './keys';
import type { ReceiverForm, StoredRoute } from '../types';

export const STORAGE_ID = 'msg-forwarder-storage';

type SmsRouterNativeModule = {
  getEncryptionKey(): Promise<string>;
};

let storage: MMKV | null = null;
let initPromise: Promise<void> | null = null;

export function initStorage(): Promise<void> {
  if (storage) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const native = (NativeModules as { SmsRouterModule?: SmsRouterNativeModule })
      .SmsRouterModule;
    if (!native) {
      throw new Error('SmsRouterModule native module is not linked.');
    }
    const encryptionKey = await native.getEncryptionKey();
    storage = createMMKV({ id: STORAGE_ID, encryptionKey });
  })();

  return initPromise;
}

function requireStorage(): MMKV {
  if (!storage) {
    throw new Error('Storage not initialized — call initStorage() first.');
  }
  return storage;
}

const createRouteId = () =>
  `route_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeRoute = (route: ReceiverForm | StoredRoute): StoredRoute => ({
  ...route,
  id: 'id' in route && route.id ? route.id : createRouteId(),
});

export const StorageHelpers = {
  saveRoutes: (routes: StoredRoute[]) => {
    requireStorage().set(StorageKeys.ROUTES, JSON.stringify(routes));
  },
  getRoutes: (): StoredRoute[] => {
    const data = requireStorage().getString(StorageKeys.ROUTES);
    if (!data) {
      return [];
    }

    try {
      const parsed = JSON.parse(data) as Array<ReceiverForm | StoredRoute>;
      const routes = parsed.map(normalizeRoute);
      const needsMigration = parsed.some(
        route => !('id' in route) || typeof route.id !== 'string' || route.id.length === 0,
      );

      // Persist migrated route ids so the list has stable keys on future launches.
      if (needsMigration) {
        StorageHelpers.saveRoutes(routes);
      }

      return routes;
    } catch (e) {
      console.error('Failed to parse routes from MMKV', e);
      return [];
    }
  },
  removeRoute: (routeId: string) => {
    const routes = StorageHelpers.getRoutes().filter(route => route.id !== routeId);
    StorageHelpers.saveRoutes(routes);
    return routes;
  },
};
