import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameScreen } from './src/ui/GameScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <GameScreen />
    </SafeAreaProvider>
  );
}
