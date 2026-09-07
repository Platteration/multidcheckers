import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useEntitlements } from '../app/entitlements';
import { ThemeChoice, useSettings } from '../app/settings';
import { Button } from './Modals';
import { PIECE_SETS, SKINS, Theme, radius, spacing } from './theme';
import { useTheme } from '../app/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Game-specific rows rendered under the general ones. */
  children?: React.ReactNode;
}

export function SettingsModal({ visible, onClose, children }: Props) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { settings, update } = useSettings();
  const { owns } = useEntitlements();
  const [locked, setLocked] = useState<string | null>(null);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Settings</Text>
          <ScrollView style={{ maxHeight: 460 }}>
            <Section title="Feel">
              <Row label="Vibration" hint="A tick when you pick up, a thud when you capture.">
                <Switch value={settings.haptics} onValueChange={(v) => update({ haptics: v })} />
              </Row>
              <Row label="Sound" hint="Short clicks and whooshes.">
                <Switch value={settings.sound} onValueChange={(v) => update({ sound: v })} />
              </Row>
            </Section>
            <Section title="Seeing">
              <Row label="Piece markings" hint="Shapes as well as colours, for colour-blind players.">
                <Switch value={settings.patterns} onValueChange={(v) => update({ patterns: v })} />
              </Row>
              <Row label="Theme">
                <Choice<ThemeChoice>
                  value={settings.theme}
                  options={[
                    { id: 'system', label: 'System' },
                    { id: 'dark', label: 'Dark' },
                    { id: 'light', label: 'Light' },
                  ]}
                  onChange={(v) => update({ theme: v })}
                />
              </Row>
            </Section>
            <Section title="Look">
              <Text style={styles.label}>Board</Text>
              <Choice
                value={settings.skin}
                options={SKINS.map((s) => ({ id: s.id, label: s.premium && !owns(true) ? `✦ ${s.name}` : s.name, swatch: [s.squareLight, s.squareDark] as const }))}
                onChange={(v) => (owns(!!SKINS.find((s) => s.id === v)?.premium) ? update({ skin: v }) : setLocked(v))}
              />
              <View style={{ height: spacing.sm }} />
              <Text style={styles.label}>Pieces</Text>
              <Choice
                value={settings.pieces}
                options={PIECE_SETS.map((p) => ({ id: p.id, label: p.premium && !owns(true) ? `✦ ${p.name}` : p.name, swatch: p.colors }))}
                onChange={(v) => (owns(!!PIECE_SETS.find((p) => p.id === v)?.premium) ? update({ pieces: v }) : setLocked(v))}
              />
              {locked ? <Text style={styles.hint}>✦ items come with the Supporter pack (see Extras in the menu).</Text> : null}
            </Section>
            {children}
          </ScrollView>
          <View style={{ height: spacing.md }} />
          <Button label="Done" tone="primary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.section}>{title}</Text>
      {children}
    </View>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** A horizontal set of mutually exclusive choices. */
export interface ChoiceOption<T extends string> {
  id: T;
  label: string;
  /** One or two colours shown as dots before the label. */
  swatch?: readonly [string, string] | readonly string[];
}

export function Choice<T extends string>({ value, options, onChange }: { value: T; options: ReadonlyArray<ChoiceOption<T>>; onChange: (v: T) => void }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.choices}>
      {options.map((o) => (
        <Pressable
          key={o.id}
          onPress={() => onChange(o.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: o.id === value }}
          style={[styles.choice, o.id === value && styles.choiceOn]}
        >
          {o.swatch ? (
            <View style={{ flexDirection: 'row', marginRight: 6 }}>
              {o.swatch.map((c, i) => (
                <View key={i} style={[styles.swatch, { backgroundColor: c, marginLeft: i ? -4 : 0 }]} />
              ))}
            </View>
          ) : null}
          <Text style={[styles.choiceText, o.id === value && styles.choiceTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (colors: Theme) =>
  StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,6,20,0.85)', justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: spacing.md },
  section: { color: colors.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flexShrink: 1, justifyContent: 'flex-end' },
  choice: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelRaised },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.35)' },
  choiceOn: { borderColor: colors.travel, backgroundColor: colors.travel },
  choiceText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  choiceTextOn: { color: colors.background },
});
