import React, { useMemo } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../app/theme';
import { Button } from './Modals';
import { Theme, radius, spacing } from './theme';

interface Props {
  visible: boolean;
  solved: boolean;
  title: string;
  hasNext: boolean;
  onNext: () => void;
  onRetry: () => void;
  onList: () => void;
}

export function PuzzleResultModal({ visible, solved, title, hasNext, onNext, onRetry, onList }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onList}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={[styles.title, { color: solved ? colors.success : colors.warning }]}>{solved ? 'Solved!' : 'Not quite'}</Text>
          <Text style={styles.body}>{solved ? `${title}: done.` : `${title}: that didn't win in time. History can be rewritten, though.`}</Text>
          <View style={{ height: spacing.lg }} />
          {solved && hasNext ? (
            <>
              <Button label="Next puzzle" tone="primary" onPress={onNext} />
              <View style={{ height: spacing.sm }} />
            </>
          ) : null}
          {!solved ? (
            <>
              <Button label="Try again" tone="primary" onPress={onRetry} />
              <View style={{ height: spacing.sm }} />
            </>
          ) : null}
          <Button label="All puzzles" onPress={onList} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(5,6,20,0.85)', justifyContent: 'center', padding: spacing.lg },
    sheet: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
    title: { fontSize: 24, fontWeight: '900', marginBottom: spacing.sm },
    body: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  });
