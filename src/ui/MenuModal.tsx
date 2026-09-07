import React, { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Button } from './Modals';
import { colors, radius, spacing } from './theme';

export interface MenuItem {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost' | 'danger';
}

interface Props {
  visible: boolean;
  onClose: () => void;
  items: MenuItem[];
  /** Called after the player confirms they want to throw the current game away. */
  onNewGame: () => void;
  gameInProgress: boolean;
}

/** The hamburger menu: rules, settings, extras, and a guarded "new game". */
export function MenuModal({ visible, onClose, items, onNewGame, gameInProgress }: Props) {
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    setConfirming(false);
    onClose();
  };
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {confirming ? (
            <>
              <Text style={styles.title}>Start over?</Text>
              <Text style={styles.body}>The game in progress will be lost. Every timeline of it.</Text>
              <View style={{ height: spacing.md }} />
              <Button
                label="Yes, new game"
                tone="danger"
                onPress={() => {
                  close();
                  onNewGame();
                }}
              />
              <View style={{ height: spacing.sm }} />
              <Button label="Keep playing" onPress={() => setConfirming(false)} />
            </>
          ) : (
            <>
              <Text style={styles.title}>Menu</Text>
              {items.map((item) => (
                <View key={item.label} style={{ marginBottom: spacing.sm }}>
                  <Button
                    label={item.label}
                    tone={item.tone}
                    onPress={() => {
                      close();
                      item.onPress();
                    }}
                  />
                </View>
              ))}
              <View style={{ marginBottom: spacing.sm }}>
                <Button
                  label="New game"
                  tone="danger"
                  onPress={() => {
                    if (gameInProgress) setConfirming(true);
                    else {
                      close();
                      onNewGame();
                    }
                  }}
                />
              </View>
              <Button label="Close" onPress={close} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,6,20,0.85)', justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: spacing.md },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
});
