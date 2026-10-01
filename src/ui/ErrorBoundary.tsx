import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../app/theme';
import { Button } from './Modals';
import { spacing } from './theme';

interface Props {
  children: React.ReactNode;
  /** Throw the saved game away and start over. The boundary is remounted by the caller. */
  onReset: () => void;
}

/**
 * Last line of defence. A render that throws would otherwise unmount the whole
 * app, and if the value that caused it is the saved game, it would do so on
 * every launch.
 *
 * Two ways out, in this order, and the order is the point: drawing the tree
 * again costs nothing and often works (a transient failure, a state the screen
 * could not draw once), while clearing the saved game spends the player's
 * game - so the harmless one is offered first and the destructive one is
 * offered behind a question. The app's own rule is that anything which spends
 * what it cannot restore is confirmed, and the boundary is the last place that
 * should make an exception: what throws here is at least as likely to be our
 * bug as the record's fault, and the record is the only copy there is.
 */
export class ErrorBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <Fallback onRetry={() => this.setState({ failed: false })} onReset={this.props.onReset} />;
  }
}

function Fallback({ onRetry, onReset }: { onRetry: () => void; onReset: () => void }) {
  const colors = useTheme();
  // Asked here rather than through ConfirmModal: this is the one screen that
  // has to draw when something else would not, so it leans on nothing but a
  // View - no modal host, no provider above it.
  const [confirming, setConfirming] = React.useState(false);
  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      {confirming ? (
        <>
          <Text style={[styles.title, { color: colors.text }]}>Start a new game?</Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            The saved game is deleted from this device, every timeline of it. Your record, puzzle progress and settings
            stay.
          </Text>
          <Button label="Delete it and start" tone="danger" onPress={onReset} />
          <Button label="Keep it" tone="primary" onPress={() => setConfirming(false)} />
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: colors.text }]}>Something went wrong</Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            The game on screen could not be drawn. Try drawing it again; if it will not come back, starting a new game
            clears the saved one.
          </Text>
          <Button label="Try again" tone="primary" onPress={onRetry} />
          <Button label="Start a new game" tone="danger" onPress={() => setConfirming(true)} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 20, fontWeight: '800' },
  body: { fontSize: 14, textAlign: 'center', maxWidth: 320 },
});
