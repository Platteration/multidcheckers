import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../app/theme';
import { Button } from './Modals';
import { spacing } from './theme';

interface Props {
  children: React.ReactNode;
  /** Throw the game away and start over. The boundary is remounted by the caller. */
  onReset: () => void;
}

/**
 * Last line of defence. A render that throws would otherwise unmount the whole
 * app, and if the value that caused it is the saved game, it would do so on
 * every launch. The fallback offers a way out that clears that value.
 */
export class ErrorBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <Fallback onReset={this.props.onReset} />;
  }
}

function Fallback({ onReset }: { onReset: () => void }) {
  const colors = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Something went wrong</Text>
      <Text style={[styles.body, { color: colors.textMuted }]}>
        The game on screen could not be drawn. Starting a new game clears it.
      </Text>
      <Button label="Start a new game" tone="primary" onPress={onReset} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 20, fontWeight: '800' },
  body: { fontSize: 14, textAlign: 'center', maxWidth: 320 },
});
