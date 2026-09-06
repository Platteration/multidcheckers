import {
  applyMove,
  boardFromRows,
  countPieces,
  index,
  initialBoard,
  legalMoves,
  moveTarget,
  movesForPiece,
  pieceAt,
  placePiece,
  rawMovesForPiece,
  removePiece,
} from '../board';

describe('board setup', () => {
  it('starts with 12 pieces each on dark squares', () => {
    const b = initialBoard();
    expect(countPieces(b, 0)).toBe(12);
    expect(countPieces(b, 1)).toBe(12);
    expect(pieceAt(b, index(0, 1))).toEqual({ player: 0, king: false });
    expect(pieceAt(b, index(0, 0))).toBeNull();
    expect(pieceAt(b, index(7, 0))).toEqual({ player: 1, king: false });
  });

  it('gives Red 7 opening moves', () => {
    expect(legalMoves(initialBoard(), 0)).toHaveLength(7);
  });
});

describe('moves', () => {
  it('men step diagonally forward only', () => {
    const b = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '..r.....',
      '........',
      '........',
    ]);
    const from = index(2, 2);
    const targets = rawMovesForPiece(b, from).map(moveTarget).sort();
    expect(targets).toEqual([index(3, 1), index(3, 3)].sort());
  });

  it('kings move in all four directions', () => {
    const b = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '..R.....',
      '........',
      '........',
    ]);
    expect(rawMovesForPiece(b, index(2, 2))).toHaveLength(4);
  });

  it('captures are mandatory and chains are followed to the end', () => {
    const b = boardFromRows([
      '........',
      '........',
      '........',
      '...b....',
      '........',
      '.b......',
      'r.......',
      '........',
    ]);
    const moves = legalMoves(b, 0);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({
      from: index(1, 0),
      path: [index(3, 2), index(5, 4)],
      captures: [index(2, 1), index(4, 3)],
    });
    // Another red piece with a quiet move available is not allowed to move.
    const withExtra = boardFromRows([
      '........',
      '........',
      '........',
      '...b....',
      '........',
      '.b......',
      'r.....r.',
      '........',
    ]);
    expect(movesForPiece(withExtra, 0, index(1, 6))).toEqual([]);
    expect(legalMoves(withExtra, 0)).toHaveLength(1);
  });

  it('applies a capture chain and crowns on the far row', () => {
    const b = boardFromRows([
      '........',
      '...b....',
      '........',
      '...b....',
      '........',
      '.b......',
      'r.......',
      '........',
    ]);
    const [move] = legalMoves(b, 0);
    expect(move.path).toEqual([index(3, 2), index(5, 4), index(7, 2)]);
    const after = applyMove(b, move);
    expect(countPieces(after, 1)).toBe(0);
    expect(pieceAt(after, index(7, 2))).toEqual({ player: 0, king: true });
    expect(pieceAt(after, index(1, 0))).toBeNull();
  });

  it('stops a chain when a man is crowned midway', () => {
    const b = boardFromRows([
      '........',
      '.b...b..',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const withRed = placePiece(b, index(5, 0), { player: 0, king: false })!;
    const moves = legalMoves(withRed, 0);
    expect(moves).toHaveLength(1);
    expect(moves[0].path).toEqual([index(7, 2)]);
  });

  it('removes and places pieces, crowning on arrival', () => {
    const b = initialBoard();
    const gone = removePiece(b, index(0, 1));
    expect(pieceAt(gone, index(0, 1))).toBeNull();
    expect(placePiece(b, index(0, 1), { player: 0, king: false })).toBeNull();
    const crowned = placePiece(gone, index(7, 0), { player: 0, king: false });
    expect(crowned).toBeNull(); // occupied by black
    const empty = removePiece(gone, index(7, 0));
    expect(pieceAt(placePiece(empty, index(7, 0), { player: 0, king: false })!, index(7, 0))).toEqual({ player: 0, king: true });
  });
});
