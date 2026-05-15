import { createMMKV } from 'react-native-mmkv';
import { StorageKeys } from './keys';
import type { ReceiverForm, StoredRoute } from '../types';

export const storage = createMMKV({
  id: 'msg-forwarder-storage',
});

const createRouteId = () =>
  `route_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeRoute = (route: ReceiverForm | StoredRoute): StoredRoute => ({
  ...route,
  id: 'id' in route && route.id ? route.id : createRouteId(),
});

export const StorageHelpers = {
  saveRoutes: (routes: StoredRoute[]) => {
    storage.set(StorageKeys.ROUTES, JSON.stringify(routes));
  },
  getRoutes: (): StoredRoute[] => {
    const data = storage.getString(StorageKeys.ROUTES);
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
