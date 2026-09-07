import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EntitlementsProvider } from './src/app/entitlements';
import { keys, loadJson } from './src/app/persist';
import { ProgressProvider } from './src/app/progress';
import { SettingsProvider, useSettings } from './src/app/settings';
import { GameSetup, looksLikeSavedGame, normaliseSaved } from './src/app/setup';
import { ThemeProvider, useTheme } from './src/app/theme';
import type { GameState } from './src/engine';
import { GameScreen } from './src/ui/GameScreen';

type Saved = { history: GameState[]; setup: GameSetup };

function Root() {
  const { ready } = useSettings();
  const colors = useTheme();
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined);

  useEffect(() => {
    loadJson<unknown>(keys.game).then((v) => setSaved(looksLikeSavedGame(v) ? normaliseSaved(v) : null));
  }, []);

  if (!ready || saved === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.travel} />
      </View>
    );
  }
  return (
    <>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <GameScreen initialHistory={saved?.history} initialSetup={saved?.setup} />
    </>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <ProgressProvider>
          <EntitlementsProvider>
            <SafeAreaProvider>
              <Root />
            </SafeAreaProvider>
          </EntitlementsProvider>
        </ProgressProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}
