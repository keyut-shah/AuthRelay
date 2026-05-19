import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

import { subscribeToEventHistoryUpdated } from '../native/smsRouter';
import { StorageHelpers } from '../storage';
import { palette } from '../theme';
import type { ProcessedEventStatus, ProcessedMessageEvent } from '../types';

const ALL_ROUTES = '__all__';

const STATUS_LABEL: Record<ProcessedEventStatus, string> = {
  sent: 'SENT',
  failed: 'FAILED',
  ignored: 'IGNORED',
};

const STATUS_TONE: Record<ProcessedEventStatus, { bg: string; fg: string }> = {
  sent: { bg: palette.successLight, fg: palette.success },
  failed: { bg: palette.dangerLight, fg: palette.danger },
  ignored: { bg: palette.accentLight, fg: palette.textSecondary },
};

const REASON_LABEL: Record<string, string> = {
  no_otp_detected: 'No OTP code in message',
  no_routes_configured: 'No routes configured',
  no_route_matched: 'No route matched sender or message rules',
  missing_credentials: 'Route missing bot token or chat ID',
  network_error: 'Network error',
};

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const date = new Date(ms);
  return date.toLocaleDateString();
}

function formatExactTime(ms: number): string {
  const date = new Date(ms);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function HistoryScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const [events, setEvents] = useState<ProcessedMessageEvent[]>([]);
  const [routeFilter, setRouteFilter] = useState<string>(ALL_ROUTES);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(() => {
    setEvents(StorageHelpers.getEvents());
  }, []);

  useEffect(() => {
    reload();

    // Live updates from the native dispatcher.
    const subscription = subscribeToEventHistoryUpdated(reload);

    // Also reload when the user returns to the app — covers the case where
    // dispatcher ran while RN was dead and emit was a no-op.
    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') reload();
    });

    return () => {
      subscription.remove();
      appStateSub.remove();
    };
  }, [reload]);

  const routeNames = useMemo(() => {
    const set = new Set<string>();
    for (const event of events) {
      if (event.matchedRouteName) set.add(event.matchedRouteName);
    }
    return Array.from(set).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (routeFilter === ALL_ROUTES) return events;
    return events.filter(event => event.matchedRouteName === routeFilter);
  }, [events, routeFilter]);

  const handleRefresh = () => {
    setRefreshing(true);
    reload();
    setRefreshing(false);
  };

  const handleClear = () => {
    if (events.length === 0) return;
    Alert.alert('Clear history?', 'This removes every recorded forwarding event from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          StorageHelpers.clearEvents();
          reload();
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: ProcessedMessageEvent }) => {
    const tone = STATUS_TONE[item.status];
    const reasonText = item.reason ? REASON_LABEL[item.reason] ?? item.reason : null;
    return (
      <View style={styles.eventCard}>
        <View style={styles.eventHeader}>
          <View style={[styles.statusBadge, { backgroundColor: tone.bg }]}>
            <Text style={[styles.statusBadgeText, { color: tone.fg }]}>
              {STATUS_LABEL[item.status]}
            </Text>
          </View>
          <Text style={styles.eventTime} numberOfLines={1}>
            {formatRelativeTime(item.createdAt)}
          </Text>
        </View>

        <View style={styles.eventBodyRow}>
          <Text style={styles.eventLabel}>Sender</Text>
          <Text style={styles.eventValue} numberOfLines={1}>
            {item.sender || 'Unknown'}
          </Text>
        </View>

        {item.matchedRouteName ? (
          <View style={styles.eventBodyRow}>
            <Text style={styles.eventLabel}>Route</Text>
            <Text style={styles.eventValue} numberOfLines={1}>
              {item.matchedRouteName}
            </Text>
          </View>
        ) : null}

        {item.destinationName ? (
          <View style={styles.eventBodyRow}>
            <Text style={styles.eventLabel}>Destination</Text>
            <Text style={styles.eventValue} numberOfLines={1}>
              Telegram ({item.destinationName})
            </Text>
          </View>
        ) : null}

        <View style={styles.eventBodyRow}>
          <Text style={styles.eventLabel}>Code</Text>
          <Text style={styles.eventValueMono}>{item.maskedCode ?? '—'}</Text>
        </View>

        {reasonText ? (
          <View style={styles.reasonRow}>
            <Text style={styles.reasonText}>{reasonText}</Text>
          </View>
        ) : null}

        <Text style={styles.exactTime}>{formatExactTime(item.createdAt)}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.title}>History</Text>
          <Pressable
            onPress={handleClear}
            disabled={events.length === 0}
            style={({ pressed }) => [
              styles.clearButton,
              events.length === 0 && styles.clearButtonDisabled,
              pressed && styles.clearButtonPressed,
            ]}
          >
            <Text style={styles.clearButtonText}>Clear</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>
          {events.length === 0
            ? 'No forwarding events yet.'
            : `${filteredEvents.length} of ${events.length} event${events.length === 1 ? '' : 's'}`}
        </Text>
      </View>

      {routeNames.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterStrip}
        >
          <FilterChip
            label="All routes"
            active={routeFilter === ALL_ROUTES}
            onPress={() => setRouteFilter(ALL_ROUTES)}
          />
          {routeNames.map(routeName => (
            <FilterChip
              key={routeName}
              label={routeName}
              active={routeFilter === routeName}
              onPress={() => setRouteFilter(routeName)}
            />
          ))}
        </ScrollView>
      ) : null}

      <FlatList
        data={filteredEvents}
        keyExtractor={event => event.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: tabBarHeight + 16 },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={palette.accent} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              {events.length === 0
                ? 'Send a test SMS to a whitelisted sender and the outcome will appear here.'
                : 'No events match the current filter.'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: palette.panel,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: palette.textSecondary,
    fontWeight: '500',
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: palette.accentLight,
  },
  clearButtonDisabled: {
    opacity: 0.4,
  },
  clearButtonPressed: {
    opacity: 0.6,
  },
  clearButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  filterStrip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.panel,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  chipPressed: {
    opacity: 0.6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
  },
  eventCard: {
    backgroundColor: palette.panel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  eventTime: {
    fontSize: 12,
    color: palette.textMuted,
    fontWeight: '600',
  },
  eventBodyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 12,
  },
  eventLabel: {
    fontSize: 13,
    color: palette.textSecondary,
    fontWeight: '500',
  },
  eventValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 13,
    color: palette.textPrimary,
    fontWeight: '600',
  },
  eventValueMono: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.textPrimary,
    letterSpacing: 1,
  },
  reasonRow: {
    marginTop: 8,
    padding: 8,
    backgroundColor: palette.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  reasonText: {
    fontSize: 12,
    color: palette.textSecondary,
    fontStyle: 'italic',
  },
  exactTime: {
    marginTop: 8,
    fontSize: 11,
    color: palette.textMuted,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 13,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
