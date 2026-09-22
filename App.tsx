import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EntitlementsProvider } from './src/app/entitlements';
import { KEYS, loadJson, removeKey } from './src/app/persist';
import { ProgressProvider } from './src/app/progress';
import { StatsProvider } from './src/app/stats';
import { SettingsProvider, useSettings } from './src/app/settings';
import { Restored, restoreSaved } from './src/app/setup';
import { ThemeProvider, useTheme } from './src/app/theme';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { GameScreen } from './src/ui/GameScreen';

function Root() {
  const { ready } = useSettings();
  const colors = useTheme();
  // undefined while storage is still being read; after that a game, nothing, or
  // a record that is there and could not be replayed - which is still the only
  // copy of the player's last game, so starting fresh over it must not delete it.
  const [saved, setSaved] = useState<Restored | undefined>(undefined);

  useEffect(() => {
    loadJson<unknown>(KEYS.game).then((v) => setSaved(restoreSaved(v)));
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
      <GameScreen
        initialHistory={saved.kind === 'game' ? saved.history : undefined}
        initialSetup={saved.kind === 'game' ? saved.setup : undefined}
        keepStoredGame={saved.kind === 'unreadable'}
      />
    </>
  );
}

export default function App() {
  // Bumping the key remounts everything below it, which is how the error
  // boundary's "start a new game" gets a clean tree after clearing the save.
  const [generation, setGeneration] = useState(0);
  return (
    <SettingsProvider>
      <ThemeProvider>
        <ProgressProvider>
          <EntitlementsProvider>
            <StatsProvider>
              <SafeAreaProvider>
                <ErrorBoundary
                  key={generation}
                  onReset={() => {
                    void removeKey(KEYS.game);
                    setGeneration((g) => g + 1);
                  }}
                >
                  <Root />
                </ErrorBoundary>
              </SafeAreaProvider>
            </StatsProvider>
          </EntitlementsProvider>
        </ProgressProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}
