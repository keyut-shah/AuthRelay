import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from './src/screens/HomeScreen';

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0d1321" />
      <HomeScreen />
    </SafeAreaProvider>
  );
}

export default App;
