import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BoardRef,
  GameState,
  PLAYER_NAMES,
  latestTurn,
  maxTurn,
  playerToMoveAt,
  sameRef,
  timelineLabel,
} from '../engine';
import { MINI_HEIGHT, MINI_WIDTH, MiniBoard } from './MiniBoard';
import { colors, playerAccent, spacing } from './theme';

const SLOT = MINI_WIDTH + 10;
const ROW = MINI_HEIGHT + 16;

interface Props {
  state: GameState;
  focus: BoardRef;
  /** Boards a picked-up disc may travel to. Empty when no disc is held. */
  targets: readonly BoardRef[];
  /** The board the held disc comes from, if any. */
  origin: BoardRef | null;
  onPressBoard: (ref: BoardRef) => void;
}

/**
 * The map of every timeline. Time runs left to right (one slot per turn) and
 * each timeline is a row, starting at the turn where it branched off.
 * `targets` are the boards the currently held piece may travel to.
 */
export function MultiverseMap({ state, focus, targets, origin, onPressBoard }: Props) {
  const lastTurn = maxTurn(state);
  const width = (lastTurn + 2) * SLOT;
  const holding = origin !== null;
  const horizontal = useRef<ScrollView>(null);
  const vertical = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // Keep the focused board in view as the player jumps around the multiverse.
  useEffect(() => {
    if (!viewport.width) return;
    const x = (focus.turn + 1) * SLOT + SLOT / 2 - viewport.width / 2;
    horizontal.current?.scrollTo({ x: Math.max(0, x), animated: true });
    const y = focus.timeline * ROW + ROW / 2 - viewport.height / 2;
    vertical.current?.scrollTo({ y: Math.max(0, y), animated: true });
  }, [focus.timeline, focus.turn, viewport]);

  return (
    <ScrollView
      ref={horizontal}
      horizontal
      showsHorizontalScrollIndicator
      style={styles.outer}
      contentContainerStyle={{ minWidth: '100%' }}
      onLayout={(e) => setViewport({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <ScrollView ref={vertical} nestedScrollEnabled showsVerticalScrollIndicator contentContainerStyle={{ width, paddingBottom: spacing.md }}>
        <View style={[styles.turnRow, { width }]}>
          {Array.from({ length: lastTurn + 1 }, (_, turn) => (
            <Text
              key={turn}
              style={[
                styles.turnLabel,
                { left: (turn + 1) * SLOT, width: SLOT, color: playerAccent(playerToMoveAt(turn)) },
              ]}
            >
              t{turn}
            </Text>
          ))}
        </View>
        {state.timelines.map((tl) => {
          const labelColor = tl.createdBy === null ? colors.textMuted : playerAccent(tl.createdBy);
          return (
            <View key={tl.id} style={[styles.timelineRow, { width }]}>
              <View style={[styles.label, { left: tl.startTurn * SLOT, borderColor: labelColor }]}>
                <Text style={[styles.labelText, { color: labelColor }]}>T{tl.id + 1}</Text>
                {tl.branchedFrom ? (
                  <Text style={styles.labelSub}>
                    ↰ T{tl.branchedFrom.timeline + 1} t{tl.branchedFrom.turn}
                  </Text>
                ) : (
                  <Text style={styles.labelSub}>start</Text>
                )}
              </View>
              {tl.boards.map((board, i) => {
                const turn = tl.startTurn + i;
                const ref: BoardRef = { timeline: tl.id, turn };
                const isLatest = turn === latestTurn(tl);
                const isPending = state.status === 'playing' && isLatest && playerToMoveAt(turn) === state.toMove;
                const isTarget = targets.some((t) => sameRef(t, ref));
                const isFocus = sameRef(focus, ref);
                const isWin = !!state.win && sameRef(state.win.board, ref);
                const isNew = !holding && state.lastCreated.some((r) => sameRef(r, ref));
                const isOrigin = sameRef(origin, ref);

                let ring: string | null = null;
                let badge: string | null = null;
                if (isWin) {
                  ring = colors.success;
                  badge = 'END';
                } else if (isTarget) {
                  ring = colors.travel;
                  badge = 'GO';
                } else if (isPending) {
                  ring = playerAccent(state.toMove);
                  badge = holding ? null : 'play';
                } else if (isNew) {
                  badge = 'new';
                }
                if (isFocus) ring = colors.focus;
                const dim = holding && !isTarget && !isOrigin && !isFocus;

                return (
                  <View key={turn} style={[styles.slot, { left: (turn + 1) * SLOT }]}>
                    <MiniBoard
                      board={board}
                      ring={ring}
                      badge={badge}
                      dim={dim}
                      onPress={() => onPressBoard(ref)}
                      accessibilityLabel={`${timelineLabel(tl.id)} turn ${turn}, ${PLAYER_NAMES[playerToMoveAt(turn)]} to move${isPending ? ', waiting' : ''}${isTarget ? ', travel target' : ''}`}
                    />
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  turnRow: { height: 18, position: 'relative' },
  turnLabel: {
    position: 'absolute',
    top: 2,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    opacity: 0.85,
  },
  timelineRow: { height: ROW, position: 'relative' },
  label: {
    position: 'absolute',
    top: 8,
    width: SLOT - 10,
    height: MINI_HEIGHT,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.panel,
  },
  labelText: { fontSize: 13, fontWeight: '800' },
  labelSub: { fontSize: 8, color: colors.textMuted, marginTop: 2 },
  slot: { position: 'absolute', top: 8 },
});
