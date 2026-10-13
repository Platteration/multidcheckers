import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAccount } from '../app/account';
import { WORDS } from '../app/accountModel';
import { useTheme } from '../app/theme';
import { Button } from './Modals';
import { Theme, radius, spacing } from './theme';

/**
 * The website's one line about the account, under the header: a sign-in that did not complete,
 * a purchase unlocked, or a payment still on its way. Drawn only while there is one, which on
 * a phone, and on a site without the api/, is never.
 */
export function AccountNotice() {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { notice, dismissNotice } = useAccount();
  if (!notice) return null;
  return (
    <View style={styles.row} accessibilityRole="alert">
      <Text style={styles.text}>{notice}</Text>
      <Button label={WORDS.dismiss} small onPress={dismissNotice} />
    </View>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.panel,
    },
    text: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20, marginRight: spacing.sm },
  });
