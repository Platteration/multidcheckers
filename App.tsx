import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { keys, loadJson } from './src/app/persist';
import { SettingsProvider, useSettings } from './src/app/settings';
import type { GameState } from './src/engine';
import { GameScreen } from './src/ui/GameScreen';
import { colors } from './src/ui/theme';

interface SavedGame {
  version: number;
  history: GameState[];
}

function looksLikeSavedGame(v: unknown): v is SavedGame {
  const s = v as SavedGame;
  return !!s && s.version === 1 && Array.isArray(s.history) && s.history.length > 0 && Array.isArray(s.history[0]?.timelines);
}

function Root() {
  const { ready } = useSettings();
  const [saved, setSaved] = useState<GameState[] | null | undefined>(undefined);

  useEffect(() => {
    loadJson<unknown>(keys.game).then((v) => setSaved(looksLikeSavedGame(v) ? v.history : null));
  }, []);

  if (!ready || saved === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.travel} />
      </View>
    );
  }
  return <GameScreen initialHistory={saved ?? undefined} />;
}

export default function App() {
  return (
    <SettingsProvider>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Root />
      </SafeAreaProvider>
    </SettingsProvider>
  );
}
