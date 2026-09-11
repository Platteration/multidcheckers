import React, { useMemo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BoardRef,
  GameState,
  latestTurn,
  mandatoryTimelines,
  maxTurn,
  playerToMoveAt,
  sameRef,
  timelineLabel,
} from '../engine';
import { MINI_HEIGHT, MINI_WIDTH, MiniBoard } from './MiniBoard';
import { Theme, spacing } from './theme';
import { useTheme } from '../app/theme';

// The map's geometry: one slot per turn across, one row per timeline down.
// Exported so a test can work out which boards a viewport covers.
export const SLOT = MINI_WIDTH + 10;
export const ROW = MINI_HEIGHT + 16;
/** Height of the turn-number header above the first row. */
export const HEADER = 18;
/** Rows and columns drawn beyond the viewport, so a flick has something to land on. */
const OVERSCAN = 2;

/**
 * The part of the map worth drawing: the turns and timelines the viewport
 * covers, plus a little either side. Every board is a MiniBoard of some seventy
 * views and the board count grows with moves x timelines, so drawing all of
 * them is what makes a big multiverse unusable - and what would make an
 * imported one a denial of service however tightly the import itself is capped.
 * Both arguments are in the content's own pixels.
 */
export function visibleBand(
  scroll: { x: number; y: number },
  viewport: { width: number; height: number },
): { fromTurn: number; toTurn: number; fromTimeline: number; toTimeline: number } {
  // Nothing is measured until the first layout; a phone-sized guess draws the
  // map on that first frame rather than leaving it blank.
  const width = viewport.width || 360;
  const height = viewport.height || 240;
  // The board for turn t sits at (t + 1) * SLOT, one slot right of the labels.
  return {
    fromTurn: Math.floor(scroll.x / SLOT) - 1 - OVERSCAN,
    toTurn: Math.ceil((scroll.x + width) / SLOT) - 1 + OVERSCAN,
    fromTimeline: Math.floor((scroll.y - HEADER) / ROW) - OVERSCAN,
    toTimeline: Math.ceil((scroll.y - HEADER + height) / ROW) + OVERSCAN,
  };
}

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
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const lastTurn = maxTurn(state);
  const width = (lastTurn + 2) * SLOT;
  const holding = origin !== null;
  const mandatoryIds = useMemo(() => new Set(mandatoryTimelines(state).map((t) => t.id)), [state]);
  const horizontal = useRef<ScrollView>(null);
  const vertical = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  // One axis at a time, and only once the map has scrolled past a whole slot or
  // row: the band cannot have changed before that, and this runs on every
  // scroll event of a pair of scroll views that move independently.
  const scrolledTo = (axis: 'x' | 'y', to: number) =>
    setScroll((s) => {
      if (Math.floor(s[axis] / (axis === 'x' ? SLOT : ROW)) === Math.floor(to / (axis === 'x' ? SLOT : ROW))) return s;
      return axis === 'x' ? { x: to, y: s.y } : { x: s.x, y: to };
    });
  const band = visibleBand(scroll, viewport);
  // The turn numbers along the top are windowed with everything else.
  const firstLabel = Math.max(0, band.fromTurn);
  const labelCount = Math.max(0, Math.min(lastTurn, band.toTurn) - firstLabel + 1);

  // A time travel: fly a token from the board the piece left to the board it created.
  const flight = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const flightOpacity = useRef(new Animated.Value(0)).current;
  const travel = state.lastAction?.type === 'travel' && state.lastCreated.length === 2 ? state.lastAction : null;
  const flightKey = travel ? `${state.timelines.length}-${state.lastCreated[1].timeline}-${state.lastCreated[1].turn}` : null;
  useEffect(() => {
    if (!travel) return;
    const from = travel.from.timeline;
    const fromTurn = state.lastCreated[0].turn - 1;
    const to = state.lastCreated[1];
    const start = { x: (fromTurn + 1) * SLOT + MINI_WIDTH / 2, y: HEADER + from * ROW + 8 + MINI_HEIGHT / 2 };
    const end = { x: (to.turn + 1) * SLOT + MINI_WIDTH / 2, y: HEADER + to.timeline * ROW + 8 + MINI_HEIGHT / 2 };
    flight.setValue(start);
    flightOpacity.setValue(1);
    Animated.sequence([
      Animated.timing(flight, { toValue: end, duration: 650, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(flightOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightKey]);
  const travellerColor = travel ? colors.players[playerToMoveAt(state.lastCreated[0].turn - 1)] : colors.travel;

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
      scrollEventThrottle={16}
      onScroll={(e) => scrolledTo('x', e.nativeEvent.contentOffset.x)}
      onLayout={(e) => setViewport({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <ScrollView
        ref={vertical}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        scrollEventThrottle={16}
        onScroll={(e) => scrolledTo('y', e.nativeEvent.contentOffset.y)}
        contentContainerStyle={{ width, paddingBottom: spacing.md }}
      >
        <View style={{ width, position: 'relative' }}>
        <View style={[styles.turnRow, { width }]}>
          {Array.from({ length: labelCount }, (_, i) => firstLabel + i).map((turn) => (
            <Text
              key={turn}
              style={[
                styles.turnLabel,
                { left: (turn + 1) * SLOT, width: SLOT, color: colors.playerAccent[playerToMoveAt(turn)] },
              ]}
            >
              t{turn}
            </Text>
          ))}
        </View>
        {state.timelines.map((tl) => {
          if (!tl.branchedFrom) return null;
          // A line from the bottom of the board this timeline branched from down to its label.
          const x = (tl.branchedFrom.turn + 1) * SLOT + MINI_WIDTH / 2;
          const top = HEADER + tl.branchedFrom.timeline * ROW + 8 + MINI_HEIGHT;
          const bottom = HEADER + tl.id * ROW + 8;
          const color = tl.createdBy === null ? colors.textMuted : colors.playerAccent[tl.createdBy];
          return (
            <View key={`link-${tl.id}`} pointerEvents="none" style={[styles.link, { left: x - 1, top, height: Math.max(0, bottom - top), backgroundColor: color }]} />
          );
        })}
        {state.timelines.map((tl) => {
          // A row outside the viewport keeps its space and nothing else, so the
          // rows that are drawn sit where the scroll position expects them.
          if (tl.id < band.fromTimeline || tl.id > band.toTimeline) {
            return <View key={tl.id} style={[styles.timelineRow, { width }]} />;
          }
          const labelColor = tl.createdBy === null ? colors.textMuted : colors.playerAccent[tl.createdBy];
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
                if (turn < band.fromTurn || turn > band.toTurn) return null;
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
                  ring = colors.playerAccent[state.toMove];
                  badge = holding ? null : mandatoryIds.has(tl.id) ? 'play' : 'later';
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
                      accessibilityLabel={`${timelineLabel(tl.id)} turn ${turn}, ${colors.playerNames[playerToMoveAt(turn)]} to move${isPending ? ', waiting' : ''}${isTarget ? ', travel target' : ''}`}
                    />
                  </View>
                );
              })}
            </View>
          );
        })}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.flyer,
            { backgroundColor: travellerColor, opacity: flightOpacity, transform: [{ translateX: flight.x }, { translateY: flight.y }] },
          ]}
        />
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
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
  link: { position: 'absolute', width: 2, opacity: 0.55, borderRadius: 1 },
  flyer: {
    position: 'absolute',
    left: -9,
    top: -9,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#ffffff',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
});
