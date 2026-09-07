import * as Clipboard from 'expo-clipboard';
import React, { useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../app/theme';
import { Button } from './Modals';
import { Theme, radius, spacing } from './theme';

interface Props {
  visible: boolean;
  /** The current game as a code, or null when there is nothing to share yet. */
  code: string | null;
  onLoad: (code: string) => string | null;
  onClose: () => void;
}

/** Share the game as a code and load one back: play by message, no server needed. */
export function ShareModal({ visible, code, onLoad, onClose }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pasted, setPasted] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const copy = async () => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      setNote('Copied. Paste it into any message.');
    } catch {
      setNote('Could not reach the clipboard; select the code and copy it by hand.');
    }
  };

  const share = async () => {
    if (!code) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'share' in navigator) {
        await (navigator as { share: (d: { text: string }) => Promise<void> }).share({ text: code });
      } else {
        await Share.share({ message: code });
      }
    } catch {
      await copy();
    }
  };

  const load = () => {
    const problem = onLoad(pasted);
    setNote(problem ?? 'Loaded. Your turn, or theirs.');
    if (!problem) setPasted('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Play by message</Text>
          <Text style={styles.body}>
            Send this code to a friend. They load it, make their move, and send the code back. Every timeline
            travels with it.
          </Text>
          <ScrollView style={styles.codeBox} horizontal={false}>
            <Text selectable style={styles.code}>
              {code ?? 'Make a move first, then come back here.'}
            </Text>
          </ScrollView>
          <View style={styles.row}>
            <Button label="Copy" small onPress={copy} disabled={!code} />
            <View style={{ width: spacing.sm }} />
            <Button label="Share…" small tone="primary" onPress={share} disabled={!code} />
          </View>
          <Text style={[styles.body, { marginTop: spacing.md }]}>Got a code? Paste it here.</Text>
          <TextInput
            value={pasted}
            onChangeText={setPasted}
            placeholder="5DCK.…"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={styles.input}
            accessibilityLabel="Game code to load"
          />
          <Button label="Load this game" small onPress={load} disabled={!pasted.trim()} />
          {note ? <Text style={styles.note}>{note}</Text> : null}
          <View style={{ height: spacing.md }} />
          <Button label="Close" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(5,6,20,0.85)', justifyContent: 'center', padding: spacing.lg },
    sheet: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
    title: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: spacing.xs },
    body: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
    codeBox: { maxHeight: 80, marginVertical: spacing.sm, backgroundColor: colors.panelRaised, borderRadius: radius.md, padding: spacing.sm },
    code: { color: colors.text, fontSize: 11, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
    row: { flexDirection: 'row' },
    input: {
      marginVertical: spacing.sm,
      minHeight: 60,
      color: colors.text,
      backgroundColor: colors.panelRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm,
      fontSize: 12,
    },
    note: { color: colors.travel, fontSize: 12, marginTop: spacing.sm },
  });
