import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Board, SIZE, index, isPlayable } from '../engine';
import { Theme, radius } from './theme';
import { useTheme } from '../app/theme';

export interface Destination {
  square: number;
  capture: boolean;
}

interface Props {
  board: Board;
  cellSize: number;
  selected?: number | null;
  destinations?: readonly Destination[];
  /** Squares to tint, e.g. where the last move came from and went to. */
  marks?: readonly number[];
  interactive: boolean;
  /** Draw a shape on each piece as well as its colour (colour-blind friendly). */
  patterns?: boolean;
  onPressSquare?: (square: number) => void;
}

/** The big playable board: 8x8 squares with pieces drawn as discs. */
export function CheckerBoard({ board, cellSize, selected, destinations, marks, interactive, patterns, onPressSquare }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rows: React.ReactNode[] = [];
  const pieceSize = Math.round(cellSize * 0.78);
  for (let r = SIZE - 1; r >= 0; r--) {
    const cells: React.ReactNode[] = [];
    for (let c = 0; c < SIZE; c++) {
      const sq = index(r, c);
      const piece = board.cells[sq];
      const dark = isPlayable(r, c);
      const dest = destinations?.find((d) => d.square === sq);
      const marked = marks?.includes(sq) ?? false;
      const isSelected = selected === sq;
      const label = `${String.fromCharCode(97 + c)}${r + 1}${
        piece ? `, ${colors.playerNames[piece.player]} ${piece.king ? 'king' : 'man'}` : ''
      }${dest ? (dest.capture ? ', jump here' : ', move here') : ''}`;
      cells.push(
        <Pressable
          key={c}
          disabled={!interactive || !dark}
          onPress={onPressSquare ? () => onPressSquare(sq) : undefined}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[
            styles.square,
            { width: cellSize, height: cellSize, backgroundColor: dark ? colors.squareDark : colors.squareLight },
            marked && dark && styles.marked,
            isSelected && styles.selectedSquare,
          ]}
        >
          {piece ? (
            <View
              style={[
                styles.piece,
                {
                  width: pieceSize,
                  height: pieceSize,
                  borderRadius: pieceSize / 2,
                  backgroundColor: colors.players[piece.player],
                  borderColor: colors.playersEdge[piece.player],
                },
                isSelected && styles.selectedPiece,
              ]}
            >
              {piece.king ? (
                <Text style={[styles.crown, { fontSize: pieceSize * 0.55, color: colors.playersInk[piece.player] }]}>♛</Text>
              ) : patterns ? (
                <View
                  style={{
                    width: pieceSize * 0.34,
                    height: pieceSize * 0.34,
                    borderRadius: pieceSize * 0.17,
                    backgroundColor: piece.player === 0 ? colors.playersInk[0] : 'transparent',
                    borderWidth: piece.player === 1 ? Math.max(2, pieceSize * 0.07) : 0,
                    borderColor: colors.playersInk[1],
                    opacity: 0.85,
                  }}
                />
              ) : null}
            </View>
          ) : dest ? (
            <View
              style={[
                styles.dot,
                {
                  width: pieceSize * 0.4,
                  height: pieceSize * 0.4,
                  borderRadius: pieceSize * 0.2,
                  backgroundColor: dest.capture ? colors.warning : colors.success,
                },
              ]}
            />
          ) : null}
        </Pressable>,
      );
    }
    rows.push(
      <View key={r} style={styles.row}>
        {cells}
      </View>,
    );
  }
  return <View style={styles.board}>{rows}</View>;
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
  board: {
    alignSelf: 'center',
    borderWidth: 3,
    borderColor: colors.boardEdge,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row' },
  square: { alignItems: 'center', justifyContent: 'center' },
  marked: { backgroundColor: '#a66e3f' },
  selectedSquare: { backgroundColor: '#5d7f9a' },
  piece: {
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedPiece: { borderColor: colors.focus, borderWidth: 3.5 },
  crown: { fontWeight: '700', lineHeight: undefined },
  dot: { opacity: 0.95 },
});
