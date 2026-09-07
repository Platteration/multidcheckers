import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useProgress } from '../app/progress';
import { useTheme } from '../app/theme';
import { PUZZLES, Puzzle } from '../puzzles';
import { Button } from './Modals';
import { Theme, radius, spacing } from './theme';

interface Props {
  visible: boolean;
  onPick: (puzzle: Puzzle) => void;
  onClose: () => void;
}

/** The list of puzzles, with a tick beside the ones already solved. */
export function PuzzlesModal({ visible, onPick, onClose }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { solved } = useProgress();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Puzzles</Text>
          <Text style={styles.sub}>
            {solved.size} of {PUZZLES.length} solved. Each one teaches a trick.
          </Text>
          <ScrollView style={{ maxHeight: 440 }}>
            {PUZZLES.map((p, i) => (
              <Pressable
                key={p.id}
                onPress={() => onPick(p)}
                accessibilityRole="button"
                accessibilityLabel={`Puzzle ${i + 1}: ${p.title}${solved.has(p.id) ? ', solved' : ''}`}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.badge, solved.has(p.id) && styles.badgeDone]}>
                  <Text style={[styles.badgeText, solved.has(p.id) && { color: colors.background }]}>{solved.has(p.id) ? '✓' : i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{p.title}</Text>
                  <Text style={styles.rowBrief}>{p.brief}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ height: spacing.md }} />
          <Button label="Close" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(5,6,20,0.85)', justifyContent: 'center', padding: spacing.lg },
    sheet: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
    title: { color: colors.text, fontSize: 22, fontWeight: '800' },
    sub: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    badge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.panelRaised, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
    badgeDone: { backgroundColor: colors.success },
    badgeText: { color: colors.text, fontWeight: '800' },
    rowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    rowBrief: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  });
