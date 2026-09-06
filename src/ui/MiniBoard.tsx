import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Board, SIZE, index, isPlayable } from '../engine';
import { colors, playerColor } from './theme';

export const MINI_CELL = 6;
export const MINI_WIDTH = SIZE * MINI_CELL + 8;
export const MINI_HEIGHT = SIZE * MINI_CELL + 8;

interface Props {
  board: Board;
  /** Border colour to signal state: pending, travel target, focused, etc. */
  ring?: string | null;
  dim?: boolean;
  badge?: string | null;
  onPress?: () => void;
  accessibilityLabel?: string;
}

/** A thumbnail of one board, used in the multiverse map. */
export const MiniBoard = React.memo(function MiniBoard({ board, ring, dim, badge, onPress, accessibilityLabel }: Props) {
  const rows: React.ReactNode[] = [];
  for (let r = SIZE - 1; r >= 0; r--) {
    const cells: React.ReactNode[] = [];
    for (let c = 0; c < SIZE; c++) {
      const piece = board.cells[index(r, c)];
      cells.push(
        <View
          key={c}
          style={[styles.cell, { backgroundColor: isPlayable(r, c) ? colors.squareDark : colors.squareLight }]}
        >
          {piece ? (
            <View
              style={[
                styles.piece,
                { backgroundColor: playerColor(piece.player), borderColor: colors.playersEdge[piece.player] },
              ]}
            />
          ) : null}
        </View>,
      );
    }
    rows.push(
      <View key={r} style={styles.row}>
        {cells}
      </View>,
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      style={({ pressed }) => [
        styles.board,
        ring ? { borderColor: ring } : null,
        dim ? { opacity: 0.45 } : null,
        pressed ? { transform: [{ scale: 0.94 }] } : null,
      ]}
    >
      {rows}
      {badge ? (
        <View style={[styles.badge, ring ? { backgroundColor: ring } : null]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  board: {
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    padding: 2,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.boardEdge,
    backgroundColor: colors.boardEdge,
  },
  row: { flexDirection: 'row' },
  cell: { width: MINI_CELL, height: MINI_CELL, alignItems: 'center', justifyContent: 'center' },
  piece: { width: MINI_CELL - 1, height: MINI_CELL - 1, borderRadius: MINI_CELL / 2, borderWidth: 0.5 },
  badge: {
    position: 'absolute',
    top: -8,
    right: -6,
    paddingHorizontal: 4,
    borderRadius: 6,
    backgroundColor: colors.panelRaised,
  },
  badgeText: { color: colors.background, fontSize: 8, fontWeight: '800' },
});
