import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EntitlementsProvider } from './src/app/entitlements';
import { KEYS, loadJson, removeKey, setAsideGame } from './src/app/persist';
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
    loadJson<unknown>(KEYS.game).then(async (v) => {
      const restored = restoreSaved(v);
      // A record this build cannot replay fails the same way at every launch,
      // and the replay it fails partway through is the expensive part of the
      // launch. It is moved aside rather than tried again or deleted: kept on
      // the device, never offered again, and said out loud on the screen that
      // starts fresh over it (saveDecision's note).
      if (restored.kind === 'unreadable') await setAsideGame(v);
      setSaved(restored);
    });
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
  // The removal is awaited before the remount: the fresh tree reads the game
  // key as its first act, and a removal still in flight would be a game the
  // player asked to be rid of coming straight back.
  const startOver = () => {
    void removeKey(KEYS.game).finally(() => setGeneration((g) => g + 1));
  };
  // Two boundaries, because one below the providers cannot catch a provider.
  // The outer one is the difference between the fallback and a blank screen if
  // a stored record ever throws on its way through a provider; the inner one
  // keeps the providers mounted - and with them the theme and the settings -
  // for everything that throws under them, which is almost everything.
  return (
    <ErrorBoundary key={`shell-${generation}`} onReset={startOver}>
      <SettingsProvider>
        <ThemeProvider>
          <ProgressProvider>
            <EntitlementsProvider>
              <StatsProvider>
                <SafeAreaProvider>
                  <ErrorBoundary key={generation} onReset={startOver}>
                    <Root />
                  </ErrorBoundary>
                </SafeAreaProvider>
              </StatsProvider>
            </EntitlementsProvider>
          </ProgressProvider>
        </ThemeProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}
