import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BOT_NAMES,
  GameState,
  SIZE,
  chooseAction,
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
import { useProgress } from '../app/progress';
import { GameSetup } from '../app/setup';
import { PUZZLES, puzzleById } from '../puzzles';
import { CheckerBoard, Destination } from './CheckerBoard';
import { MenuModal } from './MenuModal';
import { NewGameModal } from './NewGameModal';
import { PuzzleResultModal } from './PuzzleResultModal';
import { PuzzlesModal } from './PuzzlesModal';
import { Button, GameOverModal, RulesModal } from './Modals';
import { MultiverseMap } from './MultiverseMap';
import { Row, Section, SettingsModal } from './SettingsModal';
import { Theme, radius, spacing } from './theme';
import { useTheme } from '../app/theme';
import { useGame } from './useGame';

interface Props {
  /** A saved game to resume, oldest state first. */
  initialHistory?: GameState[];
  initialSetup?: GameSetup;
}

export function GameScreen({ initialHistory, initialSetup }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { settings, setVariant } = useSettings();
  const rules = useMemo(
    () => ({ flyingKings: !!settings.variants.flyingKings, backCapture: !!settings.variants.backCapture }),
    [settings.variants.flyingKings, settings.variants.backCapture],
  );
  const game = useGame(initialHistory, rules, initialSetup);
  const { state, focus, selection, targets, humanTurn } = game;
  const { width, height } = useWindowDimensions();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [puzzlesOpen, setPuzzlesOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);
  const { markSolved } = useProgress();
  const [gameOverDismissed, setGameOverDismissed] = useState(false);

  useEffect(() => setHapticsEnabled(settings.haptics), [settings.haptics]);
  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);

  // Save the game whenever it changes, a moment after the last change.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (game.history.length > 1) void saveJson(keys.game, { version: 2, history: game.history, setup: game.setup });
      else void removeKey(keys.game);
    }, 250);
    return () => clearTimeout(timer);
  }, [game.history, game.setup]);

  // The bot's turn: one action at a time, with a beat between them so the
  // person can follow what is happening across the boards.
  const bot = game.setup.bot;
  const puzzle = game.setup.mode === 'puzzle' && game.setup.puzzleId ? puzzleById(game.setup.puzzleId) : undefined;
  const puzzleIndex = puzzle ? PUZZLES.findIndex((p) => p.id === puzzle.id) : -1;
  const puzzleSolved = !!puzzle && state.status === 'won' && state.win?.player === puzzle.player;
  const puzzleFailed =
    !!puzzle && !puzzleSolved && (state.status !== 'playing' || (humanTurn && game.movesUsed >= puzzle.within));
  useEffect(() => {
    if (puzzleSolved && puzzle) markSolved(puzzle.id);
  }, [puzzleSolved, puzzle, markSolved]);
  useEffect(() => {
    setResultDismissed(false);
    setShowHint(false);
  }, [game.setup.puzzleId, game.history.length === 1]);
  useEffect(() => {
    if (!bot || humanTurn || state.status !== 'playing') return;
    const timer = setTimeout(() => {
      const action = chooseAction(state, bot.level);
      if (action) game.play(action);
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, bot, humanTurn]);

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
  const accent = state.win ? colors.playerAccent[state.win.player] : colors.playerAccent[mover];

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
      ? `${colors.playerNames[state.win.player]} wins!`
      : state.status === 'draw'
        ? 'Draw - forty quiet moves each'
        : !humanTurn && bot
          ? `${BOT_NAMES[bot.level]} is thinking…`
          : `${colors.playerNames[mover]} to move · ${totalWaiting} board${totalWaiting === 1 ? '' : 's'} waiting`;

  const subtitle = puzzle
    ? `Puzzle ${puzzleIndex + 1}: ${puzzle.title} · ${Math.max(0, puzzle.within - game.movesUsed)} move${puzzle.within - game.movesUsed === 1 ? '' : 's'} left`
    : bot
      ? `you vs ${BOT_NAMES[bot.level]} · you are ${colors.playerNames[bot.player === 0 ? 1 : 0]}`
      : 'with multiverse time travel';
  let boardTitle = `${timelineLabel(focus.timeline)} · turn ${focus.turn}`;
  if (focusIsPending) boardTitle += ' · now';
  else if (focus.turn === latestRef(timeline).turn) boardTitle += state.status === 'playing' ? ' · waiting on the other side' : ' · final';
  else boardTitle += ` · past (${colors.playerNames[playerToMoveAt(focus.turn)]} was to move)`;

  let hint: string;
  if (puzzle && state.status === 'playing' && humanTurn && selection.kind === 'none') {
    hint = showHint ? puzzle.hint : puzzle.brief;
  } else if (state.status !== 'playing') {
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
  } else if (!humanTurn) {
    hint = 'The bot is taking its turn.';
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
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
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
        interactive={humanTurn && state.status === 'playing' && focusIsPending}
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
        {puzzle && selection.kind === 'none' && humanTurn && state.status === 'playing' ? (
          <Button label={showHint ? 'Brief' : 'Hint'} small onPress={() => setShowHint((h) => !h)} />
        ) : selection.kind !== 'none' ? (
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
              <Text style={{ color: colors.playerAccent[mover] }}>■</Text> waiting for {colors.playerNames[mover]}
              {'   '}
              <Text style={{ color: colors.playerAccent[otherPlayer(mover)] }}>t</Text> = {colors.playerNames[otherPlayer(mover)]}'s turns
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
        onNewGame={() => setNewGameOpen(true)}
        items={[
          { label: 'Puzzles', onPress: () => setPuzzlesOpen(true) },
          { label: 'How to play', onPress: () => setRulesOpen(true) },
          { label: 'Settings', onPress: () => setSettingsOpen(true) },
        ]}
      />
      <NewGameModal
        visible={newGameOpen}
        initial={game.setup}
        onClose={() => setNewGameOpen(false)}
        onStart={(setup) => {
          setNewGameOpen(false);
          game.startNew(setup);
        }}
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
      <PuzzlesModal
        visible={puzzlesOpen}
        onClose={() => setPuzzlesOpen(false)}
        onPick={(p) => {
          setPuzzlesOpen(false);
          game.startPuzzle(p);
        }}
      />
      <PuzzleResultModal
        visible={!!puzzle && (puzzleSolved || puzzleFailed) && !resultDismissed}
        solved={puzzleSolved}
        title={puzzle?.title ?? ''}
        hasNext={puzzleIndex >= 0 && puzzleIndex < PUZZLES.length - 1}
        onNext={() => {
          setResultDismissed(true);
          game.startPuzzle(PUZZLES[puzzleIndex + 1]);
        }}
        onRetry={() => {
          setResultDismissed(true);
          game.restart();
        }}
        onList={() => {
          setResultDismissed(true);
          setPuzzlesOpen(true);
        }}
      />
      <GameOverModal
        state={state}
        visible={!puzzle && state.status !== 'playing' && !gameOverDismissed}
        onRestart={() => {
          setGameOverDismissed(true);
          setNewGameOpen(true);
        }}
        onDismiss={() => setGameOverDismissed(true)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
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
