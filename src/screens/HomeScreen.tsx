import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getListenerStatus,
  requestSmsPermission,
  simulateIncomingSms,
  subscribeToIncomingSms,
} from '../native/smsRouter';
import { palette } from '../theme';
import type { ReceiverForm, SmsEventPreview } from '../types';

const stepLabels = [
  'Overview',
  'Permissions',
  'Telegram',
  'Receiver Rule',
] as const;

const initialForm: ReceiverForm = {
  teamName: '',
  telegramName: '',
  telegramBotToken: '',
  telegramChatId: '',
  senderFilter: '',
};

export function HomeScreen() {
  const [isActive, setIsActive] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showResultScreen, setShowResultScreen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [hasSmsPermission, setHasSmsPermission] = useState(false);
  const [ignoreBatteryOptimizations, setIgnoreBatteryOptimizations] =
    useState(false);
  const [allowAutostart, setAllowAutostart] = useState(false);
  const [receiverForm, setReceiverForm] = useState(initialForm);
  const [listenerHealth, setListenerHealth] = useState(
    'Checking Android listener bridge...',
  );
  const [latestEvent, setLatestEvent] = useState<SmsEventPreview | null>(null);

  useEffect(() => {
    const loadListenerStatus = async () => {
      const status = await getListenerStatus();

      if (!status) {
        setListenerHealth('Native listener bridge not connected yet.');
        return;
      }

      setListenerHealth(
        status.bootRecoveryEnabled
          ? 'Android receiver and boot recovery are wired.'
          : 'Receiver wired, boot recovery pending.',
      );
    };

    loadListenerStatus().catch(() => {
      setListenerHealth('Unable to read Android listener status yet.');
    });

    const subscription = subscribeToIncomingSms(event => {
      setLatestEvent(event);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const completionCount = [
    hasSmsPermission,
    ignoreBatteryOptimizations,
    receiverForm.telegramBotToken.trim().length > 0,
    receiverForm.senderFilter.trim().length > 0,
  ].filter(Boolean).length;

  const canFinishSetup =
    hasSmsPermission &&
    receiverForm.teamName.trim().length > 0 &&
    receiverForm.telegramName.trim().length > 0 &&
    receiverForm.telegramBotToken.trim().length > 0 &&
    receiverForm.telegramChatId.trim().length > 0 &&
    receiverForm.senderFilter.trim().length > 0;

  const updateForm = <K extends keyof ReceiverForm>(
    key: K,
    value: ReceiverForm[K],
  ) => {
    setReceiverForm(prev => ({ ...prev, [key]: value }));
  };

  const finishSetup = () => {
    if (!canFinishSetup) {
      return;
    }

    setIsActive(true);
    setShowOnboarding(false);
    setShowResultScreen(true);
    setCurrentStep(0);
  };

  const goNext = () => {
    if (currentStep < stepLabels.length - 1) {
      setCurrentStep(prev => prev + 1);
      return;
    }

    finishSetup();
  };

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
      return;
    }

    setShowOnboarding(false);
  };

  const handlePermissionRequest = async () => {
    const granted = await requestSmsPermission();
    setHasSmsPermission(granted);

    if (!granted) {
      Alert.alert(
        'SMS permission still missing',
        'The Android listener needs SMS permission before real OTP routing can work.',
      );
    }
  };

  const handleSimulation = () => {
    if (!isActive) {
      Alert.alert(
        'Complete setup first',
        'Activate the listener once so the simulation reflects the intended route.',
      );
      return;
    }

    const sender = receiverForm.senderFilter || 'AWS';
    const team = receiverForm.teamName || 'Shared Ops';
    simulateIncomingSms(
      sender,
      `Your ${team} OTP is 482913. Do not share this code with anyone.`,
    );
  };

  const openSetup = () => {
    setShowResultScreen(false);
    setShowOnboarding(true);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <Text style={styles.kicker}>Android-first OTP routing</Text>
          <Text style={styles.heroTitle}>MsgForwarder</Text>
          <Text style={styles.heroText}>
            Turn one company device into a shared OTP lane for your team without
            a cloud dashboard.
          </Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusPill,
                isActive ? styles.statusLive : styles.statusIdle,
              ]}>
              <Text
                style={[
                  styles.statusPillText,
                  isActive ? styles.statusLiveText : styles.statusIdleText,
                ]}>
                {isActive ? 'Listener Active' : 'Setup Required'}
              </Text>
            </View>
            <Text style={styles.statusMeta}>
              {completionCount}/4 critical setup checks prepared
            </Text>
          </View>
        </View>

        {showOnboarding ? (
          <View style={styles.wizardCard}>
            <View style={styles.wizardHeader}>
              <Text style={styles.wizardTitle}>Guided setup</Text>
              <Text style={styles.wizardText}>
                Start with one Telegram receiver, prove the flow, then we can
                expand to more destinations later.
              </Text>
            </View>

            <View style={styles.stepRail}>
              {stepLabels.map((label, index) => (
                <View key={label} style={styles.stepItem}>
                  <View
                    style={[
                      styles.stepDot,
                      index === currentStep && styles.stepDotActive,
                      index < currentStep && styles.stepDotComplete,
                    ]}>
                    <Text style={styles.stepDotText}>{index + 1}</Text>
                  </View>
                  <Text
                    style={[
                      styles.stepLabel,
                      index === currentStep && styles.stepLabelActive,
                    ]}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>

            {currentStep === 0 ? (
              <View style={styles.stepCard}>
                <Text style={styles.stepTitle}>Set the first shared route</Text>
                <Text style={styles.stepDescription}>
                  We are intentionally keeping MVP small: one team, one
                  Telegram receiver, one sender rule.
                </Text>
                <TextInput
                  placeholder="Team name, e.g. Finance Ops"
                  placeholderTextColor={palette.textMuted}
                  style={styles.input}
                  value={receiverForm.teamName}
                  onChangeText={value => updateForm('teamName', value)}
                />
                <View style={styles.hintCard}>
                  <Text style={styles.hintTitle}>Why Telegram first?</Text>
                  <Text style={styles.hintBody}>
                    It is the fastest route to a working MVP. We avoid SMS loop
                    problems and can validate forwarding before adding more
                    destinations.
                  </Text>
                </View>
              </View>
            ) : null}

            {currentStep === 1 ? (
              <View style={styles.stepCard}>
                <Text style={styles.stepTitle}>Permissions and reliability</Text>
                <Text style={styles.stepDescription}>
                  Real routing depends on SMS permission. Battery and autostart
                  settings improve reliability on many Android devices.
                </Text>
                <Pressable
                  onPress={handlePermissionRequest}
                  style={styles.permissionButton}>
                  <Text style={styles.permissionButtonText}>
                    {hasSmsPermission
                      ? 'SMS Permission Granted'
                      : 'Grant SMS Permission'}
                  </Text>
                </Pressable>
                <ToggleRow
                  title="SMS permission status"
                  description="This shows whether the critical Android permission is available."
                  value={hasSmsPermission}
                  onValueChange={() => undefined}
                  disabled
                />
                <ToggleRow
                  title="Battery optimization disabled"
                  description="Recommended for stronger background reliability."
                  value={ignoreBatteryOptimizations}
                  onValueChange={setIgnoreBatteryOptimizations}
                />
                <ToggleRow
                  title="Auto-start enabled on OEM devices"
                  description="Useful on Xiaomi, Vivo, Oppo, and similar Android variants."
                  value={allowAutostart}
                  onValueChange={setAllowAutostart}
                />
              </View>
            ) : null}

            {currentStep === 2 ? (
              <View style={styles.stepCard}>
                <Text style={styles.stepTitle}>Add Telegram receiver</Text>
                <Text style={styles.stepDescription}>
                  For now the operator adds three things: a receiver name, bot
                  token, and chat id. Later we can support multiple receivers.
                </Text>
                <TextInput
                  placeholder="Receiver name, e.g. DevOps Alerts"
                  placeholderTextColor={palette.textMuted}
                  style={styles.input}
                  value={receiverForm.telegramName}
                  onChangeText={value => updateForm('telegramName', value)}
                />
                <TextInput
                  placeholder="Telegram bot token"
                  placeholderTextColor={palette.textMuted}
                  style={styles.input}
                  value={receiverForm.telegramBotToken}
                  onChangeText={value =>
                    updateForm('telegramBotToken', value)
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  placeholder="Telegram chat id"
                  placeholderTextColor={palette.textMuted}
                  style={styles.input}
                  value={receiverForm.telegramChatId}
                  onChangeText={value => updateForm('telegramChatId', value)}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View style={styles.hintCard}>
                  <Text style={styles.hintTitle}>MVP note</Text>
                  <Text style={styles.hintBody}>
                    We are only configuring one Telegram target right now. Once
                    this works end to end, we can add multiple receivers and
                    more platforms.
                  </Text>
                </View>
              </View>
            ) : null}

            {currentStep === 3 ? (
              <View style={styles.stepCard}>
                <Text style={styles.stepTitle}>Create the first sender rule</Text>
                <Text style={styles.stepDescription}>
                  Keep the first rule narrow. Example: `AWS`, `HDFC`, or a
                  specific bank or service sender id.
                </Text>
                <TextInput
                  placeholder="Sender filter, e.g. AWS or HDFC"
                  placeholderTextColor={palette.textMuted}
                  style={styles.input}
                  value={receiverForm.senderFilter}
                  onChangeText={value => updateForm('senderFilter', value)}
                />
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>Activation preview</Text>
                  <Text style={styles.summaryLine}>
                    Incoming sender containing{' '}
                    <Text style={styles.summaryValue}>
                      {receiverForm.senderFilter || '...'}
                    </Text>
                  </Text>
                  <Text style={styles.summaryLine}>
                    will route to{' '}
                    <Text style={styles.summaryValue}>
                      {receiverForm.telegramName || 'Telegram receiver'}
                    </Text>
                  </Text>
                  <Text style={styles.summaryLine}>
                    inside team{' '}
                    <Text style={styles.summaryValue}>
                      {receiverForm.teamName || '...'}
                    </Text>
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.footerActions}>
              <Pressable onPress={goBack} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>
                  {currentStep === 0 ? 'Close' : 'Back'}
                </Text>
              </Pressable>
              <Pressable
                onPress={goNext}
                style={[
                  styles.primaryButton,
                  currentStep === stepLabels.length - 1 &&
                    !canFinishSetup &&
                    styles.buttonDisabled,
                ]}>
                <Text style={styles.primaryButtonText}>
                  {currentStep === stepLabels.length - 1
                    ? 'Activate Listener'
                    : 'Continue'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : showResultScreen ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultKicker}>Setup completed</Text>
            <Text style={styles.resultTitle}>Telegram receiver ready</Text>
            <Text style={styles.resultBody}>
              This is the first result screen for the MVP. It shows exactly what
              the operator configured before we move on to real Telegram
              delivery.
            </Text>

            <View style={styles.resultPanel}>
              <SnapshotLine label="Team" value={receiverForm.teamName} />
              <SnapshotLine label="Receiver name" value={receiverForm.telegramName} />
              <SnapshotLine
                label="Bot token"
                value={maskToken(receiverForm.telegramBotToken)}
              />
              <SnapshotLine label="Chat id" value={receiverForm.telegramChatId} />
              <SnapshotLine label="Sender rule" value={receiverForm.senderFilter} />
            </View>

            <View style={styles.listenerCard}>
              <Text style={styles.listenerTitle}>Android listener status</Text>
              <Text style={styles.listenerBody}>{listenerHealth}</Text>
              <Pressable onPress={handleSimulation} style={styles.secondaryCta}>
                <Text style={styles.secondaryCtaText}>Simulate incoming OTP</Text>
              </Pressable>
            </View>

            <View style={styles.resultPanel}>
              <SnapshotLine
                label="Latest inbound event"
                value={
                  latestEvent
                    ? `${latestEvent.sender} • ${latestEvent.source}`
                    : 'No inbound message yet'
                }
              />
              {latestEvent ? (
                <Text style={styles.eventPreview}>{latestEvent.message}</Text>
              ) : null}
            </View>

            <View style={styles.footerActions}>
              <Pressable onPress={openSetup} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Edit Setup</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Start with one Telegram route</Text>
              <Text style={styles.panelBody}>
                The first cut should do one thing well: receive OTP locally and
                prepare it for one Telegram receiver.
              </Text>
              <Pressable onPress={openSetup} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Activate Routing</Text>
              </Pressable>
            </View>

            <View style={styles.listenerCard}>
              <Text style={styles.listenerTitle}>Android listener status</Text>
              <Text style={styles.listenerBody}>{listenerHealth}</Text>
            </View>

            <View style={styles.grid}>
              <InfoCard
                title="Focused MVP"
                body="One Telegram receiver first. Multiple receivers and more integrations can come after the core flow works."
              />
              <InfoCard
                title="Result screen"
                body="After activation, the user sees the configured receiver name, token mask, chat id, and sender rule."
              />
              <InfoCard
                title="Android reality"
                body="Background and reboot recovery are in scope. Force-stop still needs user reopen, and we will surface that clearly."
              />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoTitle}>{title}</Text>
      <Text style={styles.infoBody}>{body}</Text>
    </View>
  );
}

function SnapshotLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.snapshotLine}>
      <Text style={styles.snapshotLabel}>{label}</Text>
      <Text style={styles.snapshotValue}>{value}</Text>
    </View>
  );
}

function ToggleRow({
  title,
  description,
  value,
  onValueChange,
  disabled = false,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleTextWrap}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        thumbColor={value ? palette.accent : '#d2d8e6'}
        trackColor={{ false: '#47546e', true: '#6d4e39' }}
      />
    </View>
  );
}

function maskToken(token: string) {
  if (token.length <= 8) {
    return token || 'Not set';
  }

  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.ink,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
    gap: 18,
  },
  heroCard: {
    backgroundColor: palette.panel,
    borderRadius: 28,
    padding: 24,
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
  },
  kicker: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  heroTitle: {
    color: palette.text,
    fontSize: 34,
    fontWeight: '800',
  },
  heroText: {
    color: palette.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  statusRow: {
    gap: 10,
    marginTop: 6,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusLive: {
    backgroundColor: 'rgba(61, 220, 151, 0.16)',
  },
  statusIdle: {
    backgroundColor: 'rgba(255, 140, 66, 0.18)',
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  statusLiveText: {
    color: palette.success,
  },
  statusIdleText: {
    color: palette.accent,
  },
  statusMeta: {
    color: palette.textMuted,
    fontSize: 14,
  },
  panel: {
    backgroundColor: palette.card,
    borderRadius: 24,
    padding: 20,
    gap: 14,
  },
  panelTitle: {
    color: palette.darkText,
    fontSize: 22,
    fontWeight: '800',
  },
  panelBody: {
    color: '#33415c',
    fontSize: 15,
    lineHeight: 23,
  },
  primaryButton: {
    backgroundColor: palette.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    flex: 1,
  },
  primaryButtonText: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: palette.panelSoft,
  },
  secondaryButtonText: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  listenerCard: {
    backgroundColor: '#11192b',
    borderRadius: 22,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
  },
  listenerTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '800',
  },
  listenerBody: {
    color: palette.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  secondaryCta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: palette.panelSoft,
  },
  secondaryCtaText: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  grid: {
    gap: 12,
  },
  infoCard: {
    backgroundColor: palette.panelSoft,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 8,
  },
  infoTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '700',
  },
  infoBody: {
    color: palette.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  wizardCard: {
    backgroundColor: palette.panel,
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 18,
  },
  wizardHeader: {
    gap: 8,
  },
  wizardTitle: {
    color: palette.text,
    fontSize: 24,
    fontWeight: '800',
  },
  wizardText: {
    color: palette.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  stepRail: {
    gap: 12,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.panelSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    backgroundColor: palette.accent,
  },
  stepDotComplete: {
    backgroundColor: '#244732',
  },
  stepDotText: {
    color: palette.text,
    fontWeight: '800',
  },
  stepLabel: {
    color: palette.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  stepLabelActive: {
    color: palette.text,
  },
  stepCard: {
    backgroundColor: palette.panelSoft,
    borderRadius: 22,
    padding: 18,
    gap: 14,
  },
  stepTitle: {
    color: palette.text,
    fontSize: 21,
    fontWeight: '800',
  },
  stepDescription: {
    color: palette.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: 'rgba(11, 18, 32, 0.45)',
    color: palette.text,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  hintCard: {
    backgroundColor: 'rgba(255, 140, 66, 0.13)',
    borderRadius: 18,
    padding: 16,
    gap: 6,
  },
  hintTitle: {
    color: palette.accent,
    fontSize: 15,
    fontWeight: '800',
  },
  hintBody: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 21,
  },
  permissionButton: {
    backgroundColor: palette.accentSoft,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  permissionButtonText: {
    color: palette.darkText,
    fontSize: 15,
    fontWeight: '800',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  toggleTextWrap: {
    flex: 1,
    gap: 4,
  },
  toggleTitle: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  toggleDescription: {
    color: palette.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  summaryCard: {
    backgroundColor: '#f3ede6',
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  summaryTitle: {
    color: palette.darkText,
    fontSize: 16,
    fontWeight: '800',
  },
  summaryLine: {
    color: '#33415c',
    fontSize: 14,
    lineHeight: 20,
  },
  summaryValue: {
    color: palette.darkText,
    fontWeight: '800',
  },
  resultCard: {
    backgroundColor: palette.card,
    borderRadius: 28,
    padding: 20,
    gap: 16,
  },
  resultKicker: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  resultTitle: {
    color: palette.darkText,
    fontSize: 28,
    fontWeight: '800',
  },
  resultBody: {
    color: '#33415c',
    fontSize: 15,
    lineHeight: 23,
  },
  resultPanel: {
    backgroundColor: '#f3ede6',
    borderRadius: 22,
    padding: 18,
    gap: 12,
  },
  snapshotLine: {
    gap: 4,
  },
  snapshotLabel: {
    color: '#5f6c86',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  snapshotValue: {
    color: palette.darkText,
    fontSize: 15,
    fontWeight: '600',
  },
  eventPreview: {
    color: '#33415c',
    fontSize: 13,
    lineHeight: 20,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 12,
  },
});
