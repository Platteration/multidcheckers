import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  GameState,
  PLAYER_NAMES,
  SIZE,
  getBoard,
  getTimeline,
  isPending,
  latestRef,
  moveTarget,
  otherPlayer,
  pendingTimelines,
  playerToMoveAt,
  sameRef,
  timelineLabel,
} from '../engine';
import { setHapticsEnabled, setSoundEnabled } from '../app/feedback';
import { keys, removeKey, saveJson } from '../app/persist';
import { useSettings } from '../app/settings';
import { CheckerBoard, Destination } from './CheckerBoard';
import { MenuModal } from './MenuModal';
import { Button, GameOverModal, RulesModal } from './Modals';
import { MultiverseMap } from './MultiverseMap';
import { Row, Section, SettingsModal } from './SettingsModal';
import { colors, playerAccent, radius, spacing } from './theme';
import { useGame } from './useGame';

interface Props {
  /** A saved game to resume, oldest state first. */
  initialHistory?: GameState[];
}

export function GameScreen({ initialHistory }: Props) {
  const { settings, setVariant } = useSettings();
  const rules = useMemo(
    () => ({ flyingKings: !!settings.variants.flyingKings, backCapture: !!settings.variants.backCapture }),
    [settings.variants.flyingKings, settings.variants.backCapture],
  );
  const game = useGame(initialHistory, rules);
  const { state, focus, selection, targets } = game;
  const { width, height } = useWindowDimensions();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [gameOverDismissed, setGameOverDismissed] = useState(false);

  useEffect(() => setHapticsEnabled(settings.haptics), [settings.haptics]);
  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);

  // Save the game whenever it changes, a moment after the last change.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (game.history.length > 1) void saveJson(keys.game, { version: 1, history: game.history });
      else void removeKey(keys.game);
    }, 250);
    return () => clearTimeout(timer);
  }, [game.history]);

  useEffect(() => {
    if (state.status === 'playing') setGameOverDismissed(false);
  }, [state.status]);

  const cellSize = useMemo(() => {
    const byWidth = Math.floor((width - spacing.lg * 2) / SIZE);
    const byHeight = Math.floor((height * 0.42) / SIZE);
    return Math.max(24, Math.min(52, byWidth, byHeight));
  }, [width, height]);

  const board = getBoard(state, focus) ?? state.timelines[0].boards[0];
  const timeline = getTimeline(state, focus.timeline);
  const focusIsPending = isPending(state, focus);
  const pending = pendingTimelines(state);
  const totalWaiting = pending.length;
  const mover = state.toMove;
  const accent = state.win ? playerAccent(state.win.player) : playerAccent(mover);

  const origin = selection.kind === 'none' ? null : latestRef(getTimeline(state, selection.from.timeline));
  const holdingHere = selection.kind === 'piece' && selection.from.timeline === focus.timeline && focusIsPending;
  const destinations: Destination[] = holdingHere
    ? selection.moves.map((m) => ({ square: moveTarget(m), capture: m.captures.length > 0 }))
    : [];

  // Tint the squares touched by the action that produced the focused board.
  const marks = useMemo(() => {
    const a = state.lastAction;
    if (!a || !state.lastCreated.some((r) => sameRef(r, focus))) return [];
    if (a.type === 'move') return focus.timeline === a.timeline ? [a.move.from, ...a.move.path] : [];
    return [a.from.square];
  }, [state.lastAction, state.lastCreated, focus]);

  const status =
    state.status === 'won' && state.win
      ? `${PLAYER_NAMES[state.win.player]} wins!`
      : state.status === 'draw'
        ? 'Draw - forty quiet moves each'
        : `${PLAYER_NAMES[mover]} to move · ${totalWaiting} board${totalWaiting === 1 ? '' : 's'} waiting`;

  let boardTitle = `${timelineLabel(focus.timeline)} · turn ${focus.turn}`;
  if (focusIsPending) boardTitle += ' · now';
  else if (focus.turn === latestRef(timeline).turn) boardTitle += state.status === 'playing' ? ' · waiting on the other side' : ' · final';
  else boardTitle += ` · past (${PLAYER_NAMES[playerToMoveAt(focus.turn)]} was to move)`;

  let hint: string;
  if (state.status !== 'playing') {
    hint = 'Game over. Tap any board on the map to look around, or start a new game.';
  } else if (selection.kind === 'piece') {
    if (!holdingHere) {
      hint = 'Piece picked up on another board. Tap a glowing board to send it there, or cancel.';
    } else if (selection.moves.length === 0 && game.mustCapture) {
      hint = 'Jumps are mandatory. This piece cannot jump: pick one that can, or send this one into the past.';
    } else if (targets.length > 0) {
      hint = 'Tap a highlighted square to move, or a glowing board on the map to send this piece into the past.';
    } else {
      hint = selection.moves.length > 0 ? 'Tap a highlighted square to move.' : 'This piece has no moves and its square is taken on every past board.';
    }
  } else if (focusIsPending) {
    hint = game.mustCapture ? 'You have a jump available, and jumps are mandatory. Tap a piece.' : 'Tap one of your pieces to move it, or to send it into the past.';
  } else {
    hint = 'This board is history. Only time travel can change it.';
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
            5D Checkers
          </Text>
          <Text style={styles.subtitle}>with multiverse time travel</Text>
        </View>
        <Button label="Undo" small onPress={game.undo} disabled={!game.canUndo} />
        <View style={{ width: spacing.xs }} />
        <Button label="Menu" small onPress={() => setMenuOpen(true)} />
      </View>

      <View style={[styles.statusPill, { borderColor: accent }]}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={styles.statusText}>{status}</Text>
      </View>

      <Text style={styles.boardTitle}>{boardTitle}</Text>
      <CheckerBoard
        board={board}
        cellSize={cellSize}
        interactive={state.status === 'playing' && focusIsPending}
        selected={holdingHere ? selection.from.square : null}
        destinations={destinations}
        marks={marks}
        patterns={settings.patterns}
        onPressSquare={game.pressSquare}
      />

      <View style={styles.hintRow}>
        <Text style={[styles.hint, game.error ? { color: colors.danger } : null]} numberOfLines={3}>
          {game.error ?? hint}
        </Text>
        {selection.kind !== 'none' ? (
          <Button label="Cancel" small onPress={game.cancel} />
        ) : !focusIsPending && state.status === 'playing' ? (
          <Button label="Go play" small tone="primary" onPress={game.goToWaitingBoard} />
        ) : null}
      </View>

      <View style={styles.mapHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.mapTitle}>Multiverse</Text>
          {totalWaiting > 1 && state.status === 'playing' ? (
            <View style={{ marginLeft: spacing.sm }}>
              <Button label="Next waiting ▸" small onPress={game.nextWaitingBoard} />
            </View>
          ) : null}
        </View>
        <Text style={styles.mapLegend}>
          {state.status !== 'playing' ? null : selection.kind === 'none' ? (
            <>
              <Text style={{ color: playerAccent(mover) }}>■</Text> waiting for {PLAYER_NAMES[mover]}
              {'   '}
              <Text style={{ color: playerAccent(otherPlayer(mover)) }}>t</Text> = {PLAYER_NAMES[otherPlayer(mover)]}'s turns
            </>
          ) : (
            <>
              <Text style={{ color: colors.travel }}>■</Text> can travel here
            </>
          )}
        </Text>
      </View>
      <View style={styles.map}>
        <MultiverseMap state={state} focus={focus} targets={targets} origin={origin} onPressBoard={game.focusBoard} />
      </View>

      <MenuModal
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        gameInProgress={game.canUndo && state.status === 'playing'}
        onNewGame={game.restart}
        items={[
          { label: 'How to play', onPress: () => setRulesOpen(true) },
          { label: 'Settings', onPress: () => setSettingsOpen(true) },
        ]}
      />
      <SettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <Section title="Variants (apply to new games)">
          <Row label="Flying kings" hint="Kings slide any distance and land anywhere beyond a capture.">
            <Switch value={!!settings.variants.flyingKings} onValueChange={(v) => setVariant('flyingKings', v)} />
          </Row>
          <Row label="Backward captures" hint="Men may jump backwards as well as forwards.">
            <Switch value={!!settings.variants.backCapture} onValueChange={(v) => setVariant('backCapture', v)} />
          </Row>
        </Section>
      </SettingsModal>
      <RulesModal visible={rulesOpen} onClose={() => setRulesOpen(false)} />
      <GameOverModal
        state={state}
        visible={state.status !== 'playing' && !gameOverDismissed}
        onRestart={game.restart}
        onDismiss={() => setGameOverDismissed(true)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '900', letterSpacing: 0.3 },
  subtitle: { color: colors.textMuted, fontSize: 11 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginVertical: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    backgroundColor: colors.panel,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  boardTitle: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: spacing.xs },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 52,
  },
  hint: { flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 18, marginRight: spacing.sm },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  mapTitle: { color: colors.text, fontWeight: '800', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
  mapLegend: { color: colors.textMuted, fontSize: 11 },
  map: {
    flex: 1,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    overflow: 'hidden',
  },
});
