import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from './src/screens/HomeScreen';
import { initStorage } from './src/storage';
import { palette } from './src/theme';

function App(): React.JSX.Element {
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
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#0d1321" />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Secure storage unavailable</Text>
          <Text style={styles.errorBody}>{initError}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#0d1321" />
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0d1321" />
      <HomeScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
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
});

export default App;
