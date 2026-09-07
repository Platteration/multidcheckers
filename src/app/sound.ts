/**
 * Short sound effects, guarded by the user's setting. Players are created
 * lazily on first use so app start stays fast, and every call is wrapped
 * because audio can be unavailable (web autoplay rules, missing device).
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type SoundName = 'tap' | 'thud' | 'warp' | 'spin' | 'win' | 'nope';

const SOURCES: Record<SoundName, number> = {
  tap: require('../../assets/sounds/tap.wav'),
  thud: require('../../assets/sounds/thud.wav'),
  warp: require('../../assets/sounds/warp.wav'),
  spin: require('../../assets/sounds/spin.wav'),
  win: require('../../assets/sounds/win.wav'),
  nope: require('../../assets/sounds/nope.wav'),
};

let enabled = true;
let modeSet = false;
const players: Partial<Record<SoundName, AudioPlayer>> = {};

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function playSound(name: SoundName): void {
  if (!enabled) return;
  try {
    if (!modeSet) {
      modeSet = true;
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    }
    let player = players[name];
    if (!player) {
      player = createAudioPlayer(SOURCES[name]);
      player.volume = 0.8;
      players[name] = player;
    }
    player.seekTo(0);
    player.play();
  } catch {
    // No audio available; the game is fine without it.
  }
}
