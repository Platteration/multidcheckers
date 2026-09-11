import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EntitlementsProvider } from './src/app/entitlements';
import { keys, loadJson } from './src/app/persist';
import { ProgressProvider } from './src/app/progress';
import { StatsProvider } from './src/app/stats';
import { SettingsProvider, useSettings } from './src/app/settings';
import { Restored, restoreSaved } from './src/app/setup';
import { ThemeProvider, useTheme } from './src/app/theme';
import { GameScreen } from './src/ui/GameScreen';

function Root() {
  const { ready } = useSettings();
  const colors = useTheme();
  // undefined while storage is still being read; after that a game, nothing, or
  // a record that is there and could not be replayed - which is still the only
  // copy of the player's last game, so starting fresh over it must not delete it.
  const [saved, setSaved] = useState<Restored | undefined>(undefined);

  useEffect(() => {
    loadJson<unknown>(keys.game).then((v) => setSaved(restoreSaved(v)));
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
  return (
    <SettingsProvider>
      <ThemeProvider>
        <ProgressProvider>
          <EntitlementsProvider>
            <StatsProvider>
              <SafeAreaProvider>
                <Root />
              </SafeAreaProvider>
            </StatsProvider>
          </EntitlementsProvider>
        </ProgressProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}
