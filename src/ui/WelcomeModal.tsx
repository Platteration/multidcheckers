import React, { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../app/theme';
import { Button } from './Modals';
import { Theme, radius, spacing } from './theme';

export interface WelcomePage {
  title: string;
  body: string;
  art?: React.ReactNode;
}

interface Props {
  visible: boolean;
  pages: WelcomePage[];
  onPuzzles: () => void;
  onClose: () => void;
}

/** A three-page first-launch walkthrough of the one idea that matters. */
export function WelcomeModal({ visible, pages, onPuzzles, onClose }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [index, setIndex] = useState(0);
  const page = pages[Math.min(index, pages.length - 1)];
  const last = index >= pages.length - 1;
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.step}>
            {index + 1} / {pages.length}
          </Text>
          <Text style={styles.title}>{page.title}</Text>
          {page.art ? <View style={styles.art}>{page.art}</View> : null}
          <Text style={styles.body}>{page.body}</Text>
          <View style={{ height: spacing.lg }} />
          {last ? (
            <>
              <Button label="Try a puzzle first" tone="primary" onPress={onPuzzles} />
              <View style={{ height: spacing.sm }} />
              <Button label="Just play" onPress={onClose} />
            </>
          ) : (
            <>
              <Button label="Next" tone="primary" onPress={() => setIndex(index + 1)} />
              <View style={{ height: spacing.sm }} />
              <Button label="Skip" small onPress={onClose} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(5,6,20,0.88)', justifyContent: 'center', padding: spacing.lg },
    sheet: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
    step: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
    title: { color: colors.text, fontSize: 22, fontWeight: '900', marginVertical: spacing.sm },
    art: { alignItems: 'center', marginVertical: spacing.sm },
    body: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  });
