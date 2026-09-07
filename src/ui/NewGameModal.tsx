import React, { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { GameSetup } from '../app/setup';
import { useTheme } from '../app/theme';
import { BOT_NAMES, BotLevel, Player } from '../engine';
import { Button } from './Modals';
import { Choice } from './SettingsModal';
import { Theme, radius, spacing } from './theme';

interface Props {
  visible: boolean;
  initial: GameSetup;
  onStart: (setup: GameSetup) => void;
  onClose: () => void;
}

const LEVEL_HINTS: Record<BotLevel, string> = {
  1: 'Takes what it must, loves a crown, otherwise wanders. Never travels.',
  2: 'Counts material after your best reply and keeps pushing forward.',
  3: 'Travels through time when a past board looks better. Expect branches.',
};

/** Choose who plays: two people on one phone, or you against a bot. */
export function NewGameModal({ visible, initial, onStart, onClose }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mode, setMode] = useState<GameSetup['mode']>(initial.mode);
  const [level, setLevel] = useState<BotLevel>(initial.bot?.level ?? 2);
  const [side, setSide] = useState<Player>(initial.bot ? (initial.bot.player === 0 ? 1 : 0) : 0);

  const start = () => {
    onStart(mode === 'bot' ? { mode, bot: { level, player: side === 0 ? 1 : 0 } } : { mode: 'local' });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>New game</Text>
          <Text style={styles.label}>Who's playing?</Text>
          <Choice<GameSetup['mode']>
            value={mode}
            options={[
              { id: 'local', label: 'Two players, one phone' },
              { id: 'bot', label: 'Me against a bot' },
            ]}
            onChange={setMode}
          />
          {mode === 'bot' ? (
            <>
              <View style={{ height: spacing.md }} />
              <Text style={styles.label}>Bot</Text>
              <Choice<`${BotLevel}`>
                value={`${level}`}
                options={([1, 2, 3] as BotLevel[]).map((l) => ({ id: `${l}` as `${BotLevel}`, label: BOT_NAMES[l] }))}
                onChange={(v) => setLevel(Number(v) as BotLevel)}
              />
              <Text style={styles.hint}>{LEVEL_HINTS[level]}</Text>
              <View style={{ height: spacing.md }} />
              <Text style={styles.label}>You play</Text>
              <Choice<'0' | '1'>
                value={`${side}` as '0' | '1'}
                options={[
                  { id: '0', label: `${colors.playerNames[0]} (moves first)`, swatch: [colors.players[0]] },
                  { id: '1', label: colors.playerNames[1], swatch: [colors.players[1]] },
                ]}
                onChange={(v) => setSide(Number(v) as Player)}
              />
            </>
          ) : null}
          <View style={{ height: spacing.lg }} />
          <Button label="Start" tone="primary" onPress={start} />
          <View style={{ height: spacing.sm }} />
          <Button label="Cancel" onPress={onClose} />
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
    label: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: spacing.xs },
    hint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
  });
