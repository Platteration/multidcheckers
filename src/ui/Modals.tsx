import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GameState, timelineLabel } from '../engine';
import { Theme, radius, spacing } from './theme';
import { useTheme } from '../app/theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
}

export function Button({ label, onPress, tone = 'ghost', disabled, small }: ButtonProps) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        tone === 'primary' && styles.buttonPrimary,
        tone === 'danger' && styles.buttonDanger,
        disabled && { opacity: 0.35 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.buttonText, tone === 'primary' && { color: colors.background }]}>{label}</Text>
    </Pressable>
  );
}

interface RulesProps {
  visible: boolean;
  onClose: () => void;
}

export function RulesModal({ visible, onClose }: RulesProps) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>How to play 5D Checkers</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            <Rule head="It's checkers.">
              Men move diagonally forward one square and jump over enemy pieces to capture them.
              Jumps are mandatory and chain together. Reach the far row to be crowned a king, which
              moves and jumps backwards too. Red goes first.
            </Rule>
            <Rule head="Every move is remembered.">
              Each turn creates a new board. The map at the bottom shows every board that has ever
              existed, left to right through time. Each row is a timeline.
            </Rule>
            <Rule head="You can send a piece into the past.">
              Tap one of your pieces on the newest board to pick it up. Squares it can move to light
              up, and so do the past boards it can travel to: boards where it was also your move and
              its square was empty. Tap a glowing board to send it there.
            </Rule>
            <Rule head="That creates a new timeline.">
              The past board doesn't change; instead history branches. A fresh timeline starts from
              that moment with your extra piece in it, and your opponent has to answer there too.
            </Rule>
            <Rule head="Leaving has a cost.">
              The piece is gone from the present board. Time travel is the one way to dodge a
              mandatory jump, but if it was your last piece there, you lose on that board.
            </Rule>
            <Rule head="Play every waiting board.">
              On your turn you must make one move on every board marked "play". Only then does the
              turn pass. More timelines means more to keep track of, for both of you.
            </Rule>
            <Rule head="Variants.">
              In Settings you can turn on flying kings (they slide any distance), backward captures
              for men, and "strict present", the real 5D Chess rule: only boards at the present, the
              earliest "now" anywhere, must be played; boards ahead of it are optional, and you end
              your turn yourself. They apply to the next new game.
            </Rule>
            <Rule head="Winning.">
              Wipe your opponent off any single board, or leave them a waiting board where they have
              no legal move and nowhere to travel, and you win the whole game.
            </Rule>
          </ScrollView>
          <Button label="Got it" tone="primary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Rule({ head, children }: { head: string; children: React.ReactNode }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.ruleHead}>{head}</Text>
      <Text style={styles.ruleBody}>{children}</Text>
    </View>
  );
}

interface GameOverProps {
  state: GameState;
  visible: boolean;
  onRestart: () => void;
  onDismiss: () => void;
  onReplay?: () => void;
}

export function GameOverModal({ state, visible, onRestart, onDismiss, onReplay }: GameOverProps) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const win = state.win;
  const headline = win ? `${colors.playerNames[win.player]} wins!` : "It's a draw";
  const detail = win
    ? win.reason === 'captured'
      ? `${colors.playerNames[win.player === 0 ? 1 : 0]} has no pieces left on ${timelineLabel(win.board.timeline)}, turn ${win.board.turn}.`
      : `${colors.playerNames[win.player === 0 ? 1 : 0]} is trapped on ${timelineLabel(win.board.timeline)}, turn ${win.board.turn}: no legal move and nowhere to travel.`
    : 'Forty moves each without a capture, a crowning, or a time travel.';
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={[styles.title, win ? { color: colors.playerAccent[win.player] } : null]}>{headline}</Text>
          <Text style={styles.ruleBody}>{detail}</Text>
          <View style={{ height: spacing.lg }} />
          <Button label="New game" tone="primary" onPress={onRestart} />
          <View style={{ height: spacing.sm }} />
          {onReplay ? (
            <>
              <Button label="Watch the replay" onPress={onReplay} />
              <View style={{ height: spacing.sm }} />
            </>
          ) : null}
          <Button label="Look at the boards" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

interface ConfirmProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Ask before doing something that throws the game in progress away. */
export function ConfirmModal({ visible, title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmProps) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.ruleBody}>{body}</Text>
          <View style={{ height: spacing.lg }} />
          <Button label={confirmLabel} tone="danger" onPress={onConfirm} />
          <View style={{ height: spacing.sm }} />
          <Button label={cancelLabel} tone="primary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonSmall: { paddingVertical: 8, paddingHorizontal: 12, minHeight: 36 },
  buttonPrimary: { backgroundColor: colors.travel, borderColor: colors.travel },
  buttonDanger: { borderColor: colors.danger },
  buttonText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5,6,20,0.85)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: spacing.md },
  ruleHead: { color: colors.text, fontWeight: '700', fontSize: 15, marginBottom: 2 },
  ruleBody: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
});
