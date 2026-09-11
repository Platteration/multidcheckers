import { decode, encode } from '../../app/base64';
import { decodeGame, encodeGame } from '../../app/share';
import { Action, applyAction, enumerateActions, index, newGame } from '../index';

/** A code built by hand, so a payload the app would never write can be tested. */
const codeFor = (payload: unknown): string => '5DCK.' + encode(JSON.stringify(payload));

const step = (from: number, to: number): Action => ({ type: 'move', timeline: 0, move: { from, path: [to], captures: [] } });

/**
 * A legal game that takes a time travel whenever one is on offer, played until
 * it has that many timelines. This is the shape a code grows the multiverse
 * with: every travel adds a board to the timeline it leaves and forks another,
 * so it buys more boards per byte of code than anything else can.
 */
function travelHeavy(timelines: number): { code: string; actions: Action[] } {
  const actions: Action[] = [];
  let state = newGame();
  let nth = 0;
  while (state.timelines.length < timelines && state.status === 'playing') {
    const options = enumerateActions(state, 3);
    const travels = options.filter((a) => a.type === 'travel');
    const action = travels.length ? travels[nth++ % travels.length] : options[0];
    if (!action) break;
    actions.push(action);
    state = applyAction(state, action);
  }
  return { code: codeFor({ v: 1, r: {}, m: 'local', a: actions }), actions };
}

describe('game codes', () => {
  it('round-trips text through base64', () => {
    for (const t of ['', 'a', 'ab', 'abc', 'héllo wörld ✓']) expect(decode(encode(t))).toBe(t);
  });

  it('round-trips a game with a time travel', () => {
    const actions: Action[] = [
      step(index(2, 1), index(3, 0)),
      step(index(5, 6), index(4, 7)),
      step(index(2, 3), index(3, 2)),
      step(index(5, 4), index(4, 5)),
      { type: 'travel', from: { timeline: 0, square: index(3, 2) }, to: { timeline: 0, turn: 2 } },
    ];
    const history = actions.reduce((h, a) => [...h, applyAction(h[h.length - 1], a)], [newGame({ flyingKings: true })]);
    const code = encodeGame(history, { mode: 'local' });
    expect(code.startsWith('5DCK.')).toBe(true);
    const loaded = decodeGame(code);
    expect(loaded.history).toHaveLength(history.length);
    expect(loaded.history[loaded.history.length - 1]).toEqual(history[history.length - 1]);
    expect(loaded.history[0].rules.flyingKings).toBe(true);
  });

  it('rejects junk codes', () => {
    expect(() => decodeGame('hello')).toThrow(/not a 5D/);
    expect(() => decodeGame('5DCK.!!!')).toThrow(/damaged/);
  });

  it('reads a code that a message wrapped', () => {
    // Codes are long and chat clients, email and terminals all break long
    // tokens. None of the whitespace belongs to the alphabet, so a wrapped
    // code used to fail as 'damaged' when it had survived the trip intact.
    const actions: Action[] = [step(index(2, 1), index(3, 0)), step(index(5, 6), index(4, 7))];
    const history = actions.reduce((h, a) => [...h, applyAction(h[h.length - 1], a)], [newGame()]);
    const code = encodeGame(history, { mode: 'local' });
    const wrapped = (code.match(/.{1,40}/g) ?? []).join('\n');
    expect(wrapped).not.toBe(code);
    expect(decodeGame(wrapped).history).toHaveLength(history.length);
    expect(decodeGame(`  \n${code}\r\n `).history).toHaveLength(history.length);
    expect(decodeGame(code.split('').join(' ')).history).toHaveLength(history.length);
  });

  it('takes the rule variants as booleans of its own making', () => {
    // The sender chooses the rules for the game you load, so nothing but the
    // three known keys reaches the engine, and each one as a real boolean.
    const loaded = decodeGame(
      codeFor({ v: 1, r: { flyingKings: 1, backCapture: 0, strictPresent: null, sneaky: true }, m: 'local', a: [] }),
    );
    expect(loaded.history[0].rules).toEqual({ flyingKings: true, backCapture: false, strictPresent: false });
    expect(decodeGame(codeFor({ v: 1, r: null, m: 'local', a: [] })).history[0].rules).toEqual({
      flyingKings: false,
      backCapture: false,
      strictPresent: false,
    });
  });

  it('refuses a code too large to be worth replaying', () => {
    // Every replayed state copies every timeline, and the result is saved and
    // drawn, so an entirely legal code can still be far too big to accept.
    expect(() => decodeGame('5DCK.' + 'A'.repeat(64 * 1024))).toThrow(/too large/);
    // A real game is nowhere near either cap: this one still loads.
    expect(() => decodeGame(codeFor({ v: 1, r: {}, m: 'local', a: [] }))).not.toThrow();
  });

  it('refuses a code with more actions than it will replay', () => {
    // The action cap has to be tested with a code the byte cap lets through,
    // or it is the byte cap being tested twice: 2001 moves are ~197 kB of
    // code and never reach this check, while 2001 of the cheapest action are
    // ~50 kB and only a count of them stops the replay.
    const endTurns = (n: number) => codeFor({ v: 1, r: {}, m: 'local', a: new Array(n).fill({ type: 'endTurn' }) });
    const over = endTurns(2001);
    expect(over.length).toBeLessThan(64 * 1024);
    expect(() => decodeGame(over)).toThrow(/too many moves/);
    // One action fewer is under the cap, so it is replayed and stopped by the
    // rules instead — which is what makes the throw above the count check and
    // nothing else.
    expect(() => decodeGame(endTurns(2000))).toThrow(/not legal/);
  });

  it('refuses a code that replays into more multiverse than an import may', () => {
    // Both caps above are counted on the code, and neither bounds what the code
    // builds: a travel costs about 78 bytes and buys two boards and a whole
    // timeline. So this one sits inside both of them with room to spare - which
    // is what the two expectations below say - and still outgrows the import.
    // The counts are from measured play, not from the constant under test: 400
    // actions against the strongest bot, far longer than a game played by hand,
    // reach 78 timelines, so a code of 88 has to load and one of 104 has to be
    // refused for the ceiling to be anywhere sane between them.
    const big = travelHeavy(104);
    expect(big.code.length).toBeLessThan(64 * 1024);
    expect(big.actions.length).toBeLessThan(2000);
    expect(() => decodeGame(big.code)).toThrow(/too large for this app to draw/);

    // The same game stopped short of the ceiling still loads, so it is the size
    // of the multiverse being refused above and not the shape of the actions.
    const small = travelHeavy(88);
    expect(decodeGame(small.code).history).toHaveLength(small.actions.length + 1);
  });
});
