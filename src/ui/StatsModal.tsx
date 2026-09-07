import React, { useMemo } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useProgress } from '../app/progress';
import { useStats } from '../app/stats';
import { useTheme } from '../app/theme';
import { BOT_NAMES, BotLevel } from '../engine';
import { PUZZLES } from '../puzzles';
import { Button } from './Modals';
import { Theme, radius, spacing } from './theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function StatsModal({ visible, onClose }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { stats } = useStats();
  const { solved } = useProgress();
  const row = (label: string, value: string) => (
    <View style={styles.row} key={label}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
  const local = stats.records.local ?? { played: 0, won: 0 };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Your record</Text>
          {row('Games finished', `${stats.games}`)}
          {row('Pass-and-play games', `${local.played}`)}
          {([1, 2, 3] as BotLevel[]).map((l) => {
            const r = stats.records[`bot${l}`] ?? { played: 0, won: 0 };
            return row(`Against ${BOT_NAMES[l]}`, r.played ? `${r.won} won of ${r.played}` : 'not yet');
          })}
          {row('Time travels made', `${stats.travels}`)}
          {row('Biggest multiverse', `${stats.mostTimelines} timeline${stats.mostTimelines === 1 ? '' : 's'}`)}
          {row('Longest game', `${stats.longestGame} move${stats.longestGame === 1 ? '' : 's'}`)}
          {row('Puzzles solved', `${solved.size} of ${PUZZLES.length}`)}
          <View style={{ height: spacing.lg }} />
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
    title: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: spacing.md },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    label: { color: colors.textMuted, fontSize: 14 },
    value: { color: colors.text, fontSize: 14, fontWeight: '700' },
  });
