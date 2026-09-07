import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEntitlements } from '../app/entitlements';
import { useTheme } from '../app/theme';
import { Button } from './Modals';
import { PIECE_SETS, SKINS, Theme, radius, spacing } from './theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** The Supporter pack: cosmetics and a thank-you, never anything that changes the game. */
export function ExtrasModal({ visible, onClose }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { entitlements, storeEnabled, buySupporter, restorePurchases } = useEntitlements();
  const [note, setNote] = useState<string | null>(null);
  const premiumSkins = SKINS.filter((s) => s.premium).map((s) => s.name);
  const premiumPieces = PIECE_SETS.filter((p) => p.premium).map((p) => p.name);

  const buy = async () => {
    const result = await buySupporter();
    setNote(
      result === 'purchased'
        ? 'Thank you! Everything is unlocked.'
        : result === 'cancelled'
          ? 'No charge was made.'
          : 'The store is not available in this build. Every extra is unlocked for now.',
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Supporter pack</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            <Text style={styles.body}>
              A one-time thank-you that unlocks every look in the game. It never changes the rules, the bots, or
              your chances: no boosts, no hints for sale, no loot boxes.
            </Text>
            <Text style={styles.head}>Board skins</Text>
            <Text style={styles.list}>{premiumSkins.join(' · ')}</Text>
            <Text style={styles.head}>Piece sets</Text>
            <Text style={styles.list}>{premiumPieces.join(' · ')}</Text>
            <Text style={styles.head}>And</Text>
            <Text style={styles.list}>A supporter badge on the title, and future puzzle packs as they arrive.</Text>
            <View style={{ height: spacing.md }} />
            {entitlements.supporter ? (
              <Text style={styles.owned}>You own the Supporter pack. Thank you.</Text>
            ) : (
              <Text style={styles.body}>
                {storeEnabled ? 'Available in the store.' : 'The store is not wired up in this build, so everything is unlocked for everyone.'}
              </Text>
            )}
          </ScrollView>
          <View style={{ height: spacing.md }} />
          {!entitlements.supporter ? (
            <>
              <Button label="Get the Supporter pack" tone="primary" onPress={buy} disabled={!storeEnabled} />
              <View style={{ height: spacing.sm }} />
              <Button label="Restore purchases" small onPress={() => restorePurchases().then(() => setNote('Checked.'))} disabled={!storeEnabled} />
            </>
          ) : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
          <View style={{ height: spacing.sm }} />
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
    title: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: spacing.sm },
    body: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    head: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 1 },
    list: { color: colors.text, fontSize: 14, marginTop: 2 },
    owned: { color: colors.success, fontSize: 14, fontWeight: '700' },
    note: { color: colors.travel, fontSize: 12, marginTop: spacing.sm },
  });
