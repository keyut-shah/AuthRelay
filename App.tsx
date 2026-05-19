import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { HistoryScreen } from './src/screens/HistoryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { initStorage } from './src/storage';
import { palette } from './src/theme';

const Tab = createBottomTabNavigator();

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={[styles.tabIcon, { color }]}>{glyph}</Text>;
}

const renderHomeIcon = ({ color }: { color: string }) => <TabIcon glyph="●" color={color} />;
const renderHistoryIcon = ({ color }: { color: string }) => <TabIcon glyph="◆" color={color} />;

function AppShell(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    initStorage()
      .then(() => setReady(true))
      .catch(error => {
        const message =
          error instanceof Error ? error.message : 'Unable to initialize secure storage.';
        setInitError(message);
      });
  }, []);

  if (initError) {
    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor={palette.bg} />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Secure storage unavailable</Text>
          <Text style={styles.errorBody}>{initError}</Text>
        </View>
      </>
    );
  }

  if (!ready) {
    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor={palette.bg} />
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </>
    );
  }

  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor={palette.bg} />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: palette.accent,
            tabBarInactiveTintColor: palette.textMuted,
            tabBarStyle: [
              styles.tabBar,
              {
                height: 56 + insets.bottom,
                paddingBottom: Math.max(insets.bottom, 8),
              },
            ],
            tabBarLabelStyle: styles.tabLabel,
          }}
        >
          <Tab.Screen
            name="Home"
            component={HomeScreen}
            options={{ tabBarIcon: renderHomeIcon }}
          />
          <Tab.Screen
            name="History"
            component={HistoryScreen}
            options={{ tabBarIcon: renderHistoryIcon }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}

function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <AppShell />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bg,
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 8,
  },
  errorBody: {
    fontSize: 14,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  tabBar: {
    backgroundColor: palette.panel,
    borderTopColor: palette.border,
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  tabIcon: {
    fontSize: 16,
    fontWeight: '700',
  },
});

export default App;
