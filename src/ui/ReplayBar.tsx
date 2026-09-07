import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../app/theme';
import { Button } from './Modals';
import { Theme, radius, spacing } from './theme';

interface Props {
  index: number;
  count: number;
  narration: string;
  onSeek: (index: number) => void;
  onLive: () => void;
}

/** Step through a game one action at a time. */
export function ReplayBar({ index, count, narration, onSeek, onLive }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Button label="⏮" small onPress={() => onSeek(0)} disabled={index === 0} />
        <View style={{ width: spacing.xs }} />
        <Button label="◀" small onPress={() => onSeek(index - 1)} disabled={index === 0} />
        <Text style={styles.counter}>
          {index} / {count - 1}
        </Text>
        <Button label="▶" small onPress={() => onSeek(index + 1)} disabled={index >= count - 1} />
        <View style={{ width: spacing.xs }} />
        <Button label="⏭" small onPress={() => onSeek(count - 1)} disabled={index >= count - 1} />
        <View style={{ width: spacing.sm }} />
        <Button label="Back to game" small tone="primary" onPress={onLive} />
      </View>
      <Text style={styles.narration} numberOfLines={2}>
        {narration}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
    bar: {
      marginHorizontal: spacing.sm,
      marginBottom: spacing.xs,
      padding: spacing.sm,
      backgroundColor: colors.panelRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.travel,
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    counter: { color: colors.text, fontWeight: '700', marginHorizontal: spacing.sm, minWidth: 54, textAlign: 'center' },
    narration: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs, textAlign: 'center' },
  });
