import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

import {
  checkSmsPermission,
  getListenerStatus,
  isIgnoringBatteryOptimizations,
  openAutostartSettings,
  pickContact,
  requestIgnoreBatteryOptimizations,
  requestSmsPermission,
  simulateIncomingSms,
  subscribeToIncomingSms,
} from '../native/smsRouter';
import type { ListenerStatus } from '../native/smsRouter';
import { RouteFormSchema } from '../schemas';
import { buildTelegramDestinationName, getDestinationDisplayName } from '../services/destinations';
import { testDestination } from '../services/integrations';
import { extractOtp, maskMessagePreview } from '../services/otp';
import { describeSenderRule, parsePhraseList, parseSenderList } from '../services/routing';
import { StorageHelpers } from '../storage';
import { palette } from '../theme';
import type {
  DestinationConfig,
  RouteForm,
  RouteRule,
  RouteRuleView,
  SmsEventPreview,
} from '../types';

const stepLabels = ['Route', 'Permissions', 'Telegram', 'Rules', 'Review'];

const initialForm: RouteForm = {
  routeName: '',
  telegramBotToken: '',
  telegramChatId: '',
  senderSourceType: 'sender_id',
  senderPattern: '',
  contactDisplayName: '',
  contactPhoneNumbers: [],
  // Phase A defaults: keep current OTP-relay behavior. Phase B will expose
  // these as wizard controls so the user can opt out of the OTP gate or pick
  // a more precise match mode (whole-word / regex).
  requireOtp: true,
  matchMode: 'contains',
  useMessageFilters: false,
  messageFilterMode: 'include',
  messageAllowInput: '',
  messageBlockInput: '',
};

function buildRuleViews(
  rules: RouteRule[],
  destinations: DestinationConfig[],
): RouteRuleView[] {
  const byId = new Map(destinations.map(d => [d.id, d] as const));
  return rules.map(rule => ({ rule, destination: byId.get(rule.destinationId) ?? null }));
}

function formatRelative(ms: number): string {
  if (ms <= 0) return 'never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'moments ago';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString();
}

function buildRuleNarrative(form: RouteForm): string {
  const destinationName = buildTelegramDestinationName(form.telegramChatId);

  let source: string;
  if (form.senderSourceType === 'any') {
    source = 'every sender on this device';
  } else if (form.senderSourceType === 'contact') {
    source = form.contactDisplayName
      ? `${form.contactDisplayName} (${form.contactPhoneNumbers[0] || 'no number'})`
      : 'a saved contact';
  } else {
    const entries = parseSenderList(form.senderPattern);
    if (entries.length === 0) {
      source = 'a sender ID or number';
    } else if (entries.length === 1) {
      source = `messages from "${entries[0]}"`;
    } else {
      source = `messages from ${entries.map(e => `"${e}"`).join(', ')}`;
    }
  }

  const allowPatterns = parsePhraseList(form.messageAllowInput);
  const blockPatterns = parsePhraseList(form.messageBlockInput);

  let messageRule = 'Any OTP from that source will be forwarded.';
  if (form.useMessageFilters) {
    if (allowPatterns.length > 0 && blockPatterns.length > 0) {
      messageRule = `Only if the message contains ${allowPatterns.map(item => `"${item}"`).join(', ')} and does not contain ${blockPatterns.map(item => `"${item}"`).join(', ')}.`;
    } else if (allowPatterns.length > 0) {
      messageRule = `Only if the message contains ${allowPatterns
        .map(item => `"${item}"`)
        .join(', ')}.`;
    } else if (blockPatterns.length > 0) {
      messageRule = `Only if the message does not contain ${blockPatterns
        .map(item => `"${item}"`)
        .join(', ')}.`;
    }
  }

  return `Forward OTPs from ${source} to ${destinationName}. ${messageRule}`;
}

function formatPhoneSummary(phoneNumbers: string[]): string {
  if (phoneNumbers.length === 0) return 'No saved numbers';
  return phoneNumbers
    .map(number => {
      const digits = number.replace(/\D/g, '');
      if (digits.length <= 4) return number;
      return `••${digits.slice(-4)}`;
    })
    .join(', ');
}

function summarizeFilters(rule: RouteRule): string {
  if (rule.messageAllowPatterns.length === 0 && rule.messageBlockPatterns.length === 0) {
    return 'Any matched OTP';
  }

  if (rule.messageAllowPatterns.length > 0 && rule.messageBlockPatterns.length > 0) {
    return `Include: ${rule.messageAllowPatterns.join(', ')} · Exclude: ${rule.messageBlockPatterns.join(', ')}`;
  }

  if (rule.messageAllowPatterns.length > 0) {
    return `Include: ${rule.messageAllowPatterns.join(', ')}`;
  }

  return `Exclude: ${rule.messageBlockPatterns.join(', ')}`;
}

function buildSimulationMessage(rule: RouteRule): string {
  const includeHint = rule.messageAllowPatterns[0];
  const suffix = includeHint ? ` ${includeHint}.` : '';
  return `Your ${rule.routeName} code is 123456. Never share this code with anyone.${suffix}`;
}

function buildSimulationSender(rule: RouteRule): string {
  if (rule.senderSourceType === 'contact' && rule.contactPhoneNumbers[0]) {
    return rule.contactPhoneNumbers[0];
  }
  if (rule.senderSourceType === 'sender_id' && rule.senderPattern) {
    return rule.senderPattern;
  }
  return 'TEST-SENDER';
}

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [rules, setRules] = useState<RouteRule[]>(StorageHelpers.getRules());
  const [destinations, setDestinations] = useState<DestinationConfig[]>(
    StorageHelpers.getDestinations(),
  );
  const ruleViews = useMemo(() => buildRuleViews(rules, destinations), [rules, destinations]);

  const [showWizard, setShowWizard] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const [hasSmsPermission, setHasSmsPermission] = useState(false);
  const [ignoreBatteryOptimizations, setIgnoreBatteryOptimizations] = useState(false);
  const [autostartAttempted, setAutostartAttempted] = useState(false);

  const [routeForm, setRouteForm] = useState(initialForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof RouteForm, string>>>({});

  const [contactPickerBusy, setContactPickerBusy] = useState(false);

  const [listenerStatus, setListenerStatus] = useState<ListenerStatus | null>(null);
  const [listenerHealth, setListenerHealth] = useState('Checking listener status...');
  const [latestEvent, setLatestEvent] = useState<SmsEventPreview | null>(null);
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);

  const navigation = useNavigation();

  useEffect(() => {
    const parent = navigation.getParent();
    parent?.setOptions({
      tabBarStyle: showWizard
        ? { display: 'none' }
        : {
            backgroundColor: palette.panel,
            borderTopColor: palette.border,
            height: 56 + insets.bottom,
            paddingTop: 6,
            paddingBottom: Math.max(insets.bottom, 8),
          },
    });
  }, [insets.bottom, navigation, showWizard]);

  useEffect(() => {
    const reloadSystemState = async () => {
      try {
        const [smsPermission, status, battery] = await Promise.all([
          checkSmsPermission(),
          getListenerStatus(),
          isIgnoringBatteryOptimizations(),
        ]);
        setHasSmsPermission(smsPermission);
        setIgnoreBatteryOptimizations(battery);

        if (status) {
          setListenerStatus(status);
          setAutostartAttempted(status.autostartAttemptedAt > 0);
          setListenerHealth(
            smsPermission
              ? status.bootRestoredAt > 0
                ? `Active · restored after reboot ${formatRelative(status.bootRestoredAt)}`
                : 'Active'
              : 'Inactive — SMS permission required',
          );
        } else {
          setListenerHealth('Listener disconnected');
        }
      } catch {
        setListenerHealth('Unable to verify listener status');
      }
    };

    reloadSystemState();

    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') reloadSystemState();
    });

    const subscription = subscribeToIncomingSms(event => {
      setLatestEvent(event);
    });

    return () => {
      subscription.remove();
      appStateSub.remove();
    };
  }, []);

  const updateForm = <K extends keyof RouteForm>(key: K, value: RouteForm[K]) => {
    setRouteForm(prev => ({ ...prev, [key]: value }));
    if (formErrors[key]) {
      setFormErrors(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const clearContactErrors = () => {
    setFormErrors(prev => {
      const next = { ...prev };
      delete next.contactDisplayName;
      delete next.contactPhoneNumbers;
      return next;
    });
  };

  const startNewRoute = () => {
    setRouteForm(initialForm);
    setFormErrors({});
    setCurrentStep(0);
    setShowWizard(true);
  };

  const handlePermissionRequest = async () => {
    if (hasSmsPermission) {
      Alert.alert(
        'Permission already granted',
        'SMS access is enabled. To revoke it, open the system Settings app.',
      );
      return;
    }

    const granted = await requestSmsPermission();
    setHasSmsPermission(granted);
    if (!granted) {
      Alert.alert(
        'Permission required',
        'AuthRelay needs SMS access to detect incoming OTPs. Enable it in Settings if the dialog was dismissed.',
      );
    }
  };

  const handleBatteryToggle = async () => {
    if (ignoreBatteryOptimizations) {
      Alert.alert(
        'Already unrestricted',
        'AuthRelay is already exempt from battery optimization. To revoke, open Android battery settings.',
      );
      return;
    }
    const alreadyExempt = await requestIgnoreBatteryOptimizations();
    if (alreadyExempt) {
      setIgnoreBatteryOptimizations(true);
    }
  };

  const handleAutostartTrigger = async () => {
    const launched = await openAutostartSettings();
    setAutostartAttempted(true);
    if (!launched) {
      Alert.alert(
        'Open Autostart manually',
        'This device does not expose a standard autostart screen. The app-details page is now open — find the "Autostart" or "Run in background" toggle and enable it.',
      );
    }
  };

  const handleSenderSourceChange = (value: RouteForm['senderSourceType']) => {
    updateForm('senderSourceType', value);
    if (value === 'contact') clearContactErrors();
  };

  const handlePickContact = async () => {
    if (contactPickerBusy) return;
    setContactPickerBusy(true);
    try {
      const picked = await pickContact();
      if (!picked) return; // user cancelled
      setRouteForm(prev => ({
        ...prev,
        contactDisplayName: picked.displayName,
        contactPhoneNumbers: [picked.phoneNumber],
      }));
      clearContactErrors();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to open the contact picker.';
      Alert.alert('Contact picker unavailable', message);
    } finally {
      setContactPickerBusy(false);
    }
  };

  const jumpToFirstErrorStep = (errors: Partial<Record<keyof RouteForm, string>>) => {
    if (errors.routeName) {
      setCurrentStep(0);
      return;
    }

    if (errors.telegramBotToken || errors.telegramChatId) {
      setCurrentStep(2);
      return;
    }

    setCurrentStep(3);
  };

  const finishSetup = () => {
    const result = RouteFormSchema.safeParse(routeForm);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof RouteForm, string>> = {};
      const flat = result.error.flatten().fieldErrors;
      (Object.keys(flat) as (keyof RouteForm)[]).forEach(key => {
        const message = flat[key]?.[0];
        if (message) fieldErrors[key] = message;
      });
      setFormErrors(fieldErrors);
      jumpToFirstErrorStep(fieldErrors);
      return;
    }

    if (!hasSmsPermission) {
      Alert.alert('Permission required', 'Grant SMS access before creating a route.');
      setCurrentStep(1);
      return;
    }

    const clean = result.data;
    const destinationName = buildTelegramDestinationName(clean.telegramChatId);
    const destination: DestinationConfig = {
      id: StorageHelpers.newDestinationId(),
      name: destinationName,
      provider: {
        type: 'telegram',
        botToken: clean.telegramBotToken,
        chatId: clean.telegramChatId,
      },
    };

    const rule: RouteRule = {
      id: StorageHelpers.newRuleId(),
      enabled: true,
      routeName: clean.routeName,
      senderSourceType: clean.senderSourceType,
      senderPattern: clean.senderSourceType === 'sender_id' ? clean.senderPattern.trim() : '',
      contactDisplayName:
        clean.senderSourceType === 'contact' ? clean.contactDisplayName : null,
      contactPhoneNumbers:
        clean.senderSourceType === 'contact'
          ? clean.contactPhoneNumbers.map(p => p.trim()).filter(Boolean)
          : [],
      requireOtp: clean.requireOtp,
      matchMode: clean.matchMode,
      messageAllowPatterns:
        clean.useMessageFilters && clean.messageFilterMode !== 'exclude'
          ? parsePhraseList(clean.messageAllowInput)
          : [],
      messageBlockPatterns:
        clean.useMessageFilters && clean.messageFilterMode !== 'include'
          ? parsePhraseList(clean.messageBlockInput)
          : [],
      destinationId: destination.id,
    };

    const updatedDestinations = StorageHelpers.upsertDestination(destination);
    const updatedRules = StorageHelpers.upsertRule(rule);
    setDestinations(updatedDestinations);
    setRules(updatedRules);
    setRouteForm(initialForm);
    setFormErrors({});
    setShowWizard(false);
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
    setShowWizard(false);
  };

  const handleTestRule = async ({ rule, destination }: RouteRuleView) => {
    if (!destination) {
      Alert.alert('Destination Missing', 'This rule has no destination configured.');
      return;
    }

    const sender = buildSimulationSender(rule);
    const routeName = rule.routeName || 'Route';
    setActiveRuleId(rule.id);
    setTelegramStatus(`Sending Telegram test for ${routeName}...`);

    try {
      await testDestination(destination);
      setTelegramStatus(`Telegram test sent successfully for ${routeName}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to send test message.';
      Alert.alert('Telegram Test Failed', message);
      setTelegramStatus(`Telegram test failed for ${routeName}: ${message}`);
      return;
    } finally {
      setActiveRuleId(null);
    }

    simulateIncomingSms(sender, buildSimulationMessage(rule));
  };

  const handleDeleteRule = (ruleId: string) => {
    const updatedRules = StorageHelpers.removeRule(ruleId);
    setRules(updatedRules);
  };

  const renderRouteDetailsStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Route Details</Text>
      <Text style={styles.stepDescription}>
        Give this forwarding rule a label that only appears inside the app so you can
        identify it later.
      </Text>

      <View style={styles.inputWrapper}>
        <Text style={styles.inputLabel}>Route Name</Text>
        <TextInput
          style={[styles.input, formErrors.routeName && styles.inputError]}
          placeholder="e.g., Finance Login OTPs"
          placeholderTextColor={palette.textMuted}
          value={routeForm.routeName}
          onChangeText={value => updateForm('routeName', value)}
        />
        {formErrors.routeName ? (
          <Text style={styles.fieldError}>{formErrors.routeName}</Text>
        ) : null}
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>What this means</Text>
        <Text style={styles.summaryBody}>
          Route names help you recognize a rule in the route list and history. They do not
          change which SMS messages are matched.
        </Text>
      </View>
    </View>
  );

  const renderPermissionsStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>System Access</Text>
      <Text style={styles.stepDescription}>
        AuthRelay reads incoming SMS locally to detect OTPs and forwards them to Telegram.
        Nothing is sent to a cloud server. These settings keep the listener alive in the
        background.
      </Text>

      <View style={styles.permissionCard}>
        <View style={styles.permissionHeader}>
          <View style={styles.permissionTextWrap}>
            <Text style={styles.permissionTitle}>Read SMS</Text>
            <Text style={styles.permissionSubtitle}>
              Required to capture incoming OTPs before routing rules can run.
            </Text>
          </View>
          <Switch
            value={hasSmsPermission}
            onValueChange={handlePermissionRequest}
            trackColor={{ false: palette.border, true: palette.success }}
            thumbColor={palette.panel}
          />
        </View>

        <View style={styles.separator} />

        <View style={styles.permissionHeader}>
          <View style={styles.permissionTextWrap}>
            <Text style={styles.permissionTitle}>Battery Unrestricted</Text>
            <Text style={styles.permissionSubtitle}>
              Prevents Android from killing the listener to save power.
            </Text>
          </View>
          <Switch
            value={ignoreBatteryOptimizations}
            onValueChange={handleBatteryToggle}
            trackColor={{ false: palette.border, true: palette.accent }}
            thumbColor={palette.panel}
          />
        </View>

        <View style={styles.separator} />

        <View style={styles.permissionHeader}>
          <View style={styles.permissionTextWrap}>
            <Text style={styles.permissionTitle}>Auto-start (OEM)</Text>
            <Text style={styles.permissionSubtitle}>
              Required on Xiaomi, Oppo, Vivo, Huawei and similar devices so SMS receivers
              fire after a reboot.
            </Text>
            {autostartAttempted ? (
              <Text style={styles.permissionHint}>
                Settings opened — confirm autostart is enabled there.
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={handleAutostartTrigger}
            style={({ pressed }) => [
              styles.autostartButton,
              pressed && styles.autostartButtonPressed,
            ]}
          >
            <Text style={styles.autostartButtonText}>
              {autostartAttempted ? 'Reopen' : 'Open'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderTelegramStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Telegram Destination</Text>
      <Text style={styles.stepDescription}>
        Add the Telegram bot credentials and target chat. The app will generate a display
        label automatically, so you do not need to enter a separate destination name.
      </Text>

      <View style={styles.inputWrapper}>
        <Text style={styles.inputLabel}>Bot Token</Text>
        <TextInput
          style={[styles.input, formErrors.telegramBotToken && styles.inputError]}
          placeholder="123456789:AA..."
          placeholderTextColor={palette.textMuted}
          value={routeForm.telegramBotToken}
          onChangeText={value => updateForm('telegramBotToken', value)}
          secureTextEntry
          autoCapitalize="none"
        />
        {formErrors.telegramBotToken ? (
          <Text style={styles.fieldError}>{formErrors.telegramBotToken}</Text>
        ) : null}
      </View>

      <View style={styles.inputWrapper}>
        <Text style={styles.inputLabel}>Chat ID</Text>
        <TextInput
          style={[styles.input, formErrors.telegramChatId && styles.inputError]}
          placeholder="-10012345678 or @channelusername"
          placeholderTextColor={palette.textMuted}
          value={routeForm.telegramChatId}
          onChangeText={value => updateForm('telegramChatId', value)}
          autoCapitalize="none"
        />
        {formErrors.telegramChatId ? (
          <Text style={styles.fieldError}>{formErrors.telegramChatId}</Text>
        ) : null}
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Generated destination label</Text>
        <Text style={styles.summaryValueBlock}>
          {buildTelegramDestinationName(routeForm.telegramChatId)}
        </Text>
      </View>
    </View>
  );

  const renderSenderSourceSelector = () => {
    const options: Array<{
      value: RouteForm['senderSourceType'];
      title: string;
      subtitle: string;
    }> = [
      {
        value: 'any',
        title: 'Any sender',
        subtitle: 'Forward every OTP that arrives on this device. Pair with a message filter to narrow it down.',
      },
      {
        value: 'sender_id',
        title: 'Sender ID or number',
        subtitle: 'Banks, brand short codes (HDFCBK, AWS) or a single phone number you type in.',
      },
      {
        value: 'contact',
        title: 'Saved contact',
        subtitle: 'Pick from your Android contacts. No contacts permission is needed.',
      },
    ];

    return (
      <View style={styles.inputWrapper}>
        <Text style={styles.inputLabel}>Who should the OTP come from?</Text>
        <View style={styles.sourceList}>
          {options.map(option => {
            const active = routeForm.senderSourceType === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => handleSenderSourceChange(option.value)}
                style={[styles.sourceOption, active && styles.sourceOptionActive]}
              >
                <View style={[styles.sourceRadio, active && styles.sourceRadioActive]}>
                  {active ? <View style={styles.sourceRadioDot} /> : null}
                </View>
                <View style={styles.sourceTextWrap}>
                  <Text style={styles.sourceOptionTitle}>{option.title}</Text>
                  <Text style={styles.sourceOptionSubtitle}>{option.subtitle}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  const renderAnySenderHint = () => (
    <View style={styles.warningCard}>
      <Text style={styles.warningTitle}>Heads up</Text>
      <Text style={styles.warningBody}>
        Any-sender mode forwards every OTP that lands on this device. Add a message filter
        below if you want to narrow it down (for example, only messages that mention
        "login" or "verification").
      </Text>
    </View>
  );

  const renderManualSenderFields = () => (
    <View style={styles.inputWrapper}>
      <Text style={styles.inputLabel}>Sender ID or Number</Text>
      <TextInput
        style={[styles.input, formErrors.senderPattern && styles.inputError]}
        placeholder="HDFCBK, AWS, AMAZON, +91 98765 43210"
        placeholderTextColor={palette.textMuted}
        value={routeForm.senderPattern}
        onChangeText={value => updateForm('senderPattern', value)}
        autoCapitalize="none"
      />
      <Text style={styles.inputHint}>
        Comma-separated. Any match forwards. Case doesn't matter — "aws" and "AWS" are
        the same. For phone numbers, spaces / +country code / dashes are ignored when
        matching.
      </Text>
      {formErrors.senderPattern ? (
        <Text style={styles.fieldError}>{formErrors.senderPattern}</Text>
      ) : null}
    </View>
  );

  const renderContactFields = () => {
    const selected = routeForm.contactDisplayName && routeForm.contactPhoneNumbers[0];
    return (
      <View style={styles.contactSection}>
        {selected ? (
          <View style={styles.selectedContactCard}>
            <View style={styles.selectedContactRow}>
              <View style={styles.contactAvatar}>
                <Text style={styles.contactAvatarText}>
                  {routeForm.contactDisplayName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.selectedContactTextWrap}>
                <Text style={styles.selectedContactTitle}>
                  {routeForm.contactDisplayName}
                </Text>
                <Text style={styles.selectedContactMeta}>
                  {formatPhoneSummary(routeForm.contactPhoneNumbers)}
                </Text>
              </View>
              <Pressable
                onPress={() => { handlePickContact(); }}
                disabled={contactPickerBusy}
                style={({ pressed }) => [
                  styles.inlineButton,
                  pressed && styles.inlineButtonPressed,
                ]}
              >
                <Text style={styles.inlineButtonText}>
                  {contactPickerBusy ? 'Opening…' : 'Change'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => { handlePickContact(); }}
            disabled={contactPickerBusy}
            style={({ pressed }) => [
              styles.pickerButton,
              pressed && styles.pickerButtonPressed,
            ]}
          >
            <View style={styles.pickerIconCircle}>
              <Text style={styles.pickerIcon}>+</Text>
            </View>
            <View style={styles.pickerTextWrap}>
              <Text style={styles.pickerTitle}>
                {contactPickerBusy ? 'Opening contacts…' : 'Pick from Contacts'}
              </Text>
              <Text style={styles.pickerSubtitle}>
                Opens your phone's contact picker. We only read the number you choose.
              </Text>
            </View>
          </Pressable>
        )}

        {formErrors.contactDisplayName || formErrors.contactPhoneNumbers ? (
          <Text style={styles.fieldError}>
            {formErrors.contactDisplayName || formErrors.contactPhoneNumbers}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderMessageFilterSection = () => (
    <View style={styles.messageRulesSection}>
      <View style={styles.permissionHeader}>
        <View style={styles.permissionTextWrap}>
          <Text style={styles.permissionTitle}>Use message text rules</Text>
          <Text style={styles.permissionSubtitle}>
            Leave this off to forward any OTP from the matched sender or saved contact.
          </Text>
        </View>
        <Switch
          value={routeForm.useMessageFilters}
          onValueChange={value => updateForm('useMessageFilters', value)}
          trackColor={{ false: palette.border, true: palette.accent }}
          thumbColor={palette.panel}
        />
      </View>

      {!routeForm.useMessageFilters ? null : (
        <>
          <View style={styles.segmentRow}>
            <Pressable
              onPress={() => updateForm('messageFilterMode', 'include')}
              style={[
                styles.segmentButton,
                routeForm.messageFilterMode === 'include' && styles.segmentButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.segmentButtonText,
                  routeForm.messageFilterMode === 'include' &&
                    styles.segmentButtonTextActive,
                ]}
              >
                Only send if text contains
              </Text>
            </Pressable>
            <Pressable
              onPress={() => updateForm('messageFilterMode', 'exclude')}
              style={[
                styles.segmentButton,
                routeForm.messageFilterMode === 'exclude' && styles.segmentButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.segmentButtonText,
                  routeForm.messageFilterMode === 'exclude' &&
                    styles.segmentButtonTextActive,
                ]}
              >
                Block if text contains
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => updateForm('messageFilterMode', 'advanced')}
            style={[
              styles.advancedModeButton,
              routeForm.messageFilterMode === 'advanced' && styles.segmentButtonActive,
            ]}
          >
            <Text
              style={[
                styles.segmentButtonText,
                routeForm.messageFilterMode === 'advanced' && styles.segmentButtonTextActive,
              ]}
            >
              Advanced: use both include and exclude
            </Text>
          </Pressable>

          {routeForm.messageFilterMode !== 'exclude' ? (
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Only send if message contains</Text>
              <TextInput
                style={[styles.input, formErrors.messageAllowInput && styles.inputError]}
                placeholder="e.g., login, verification"
                placeholderTextColor={palette.textMuted}
                value={routeForm.messageAllowInput}
                onChangeText={value => updateForm('messageAllowInput', value)}
              />
              <Text style={styles.inputHint}>
                Comma-separated. Any phrase matching is enough. Case doesn't matter.
              </Text>
              {formErrors.messageAllowInput ? (
                <Text style={styles.fieldError}>{formErrors.messageAllowInput}</Text>
              ) : null}
            </View>
          ) : null}

          {routeForm.messageFilterMode !== 'include' ? (
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Do not send if message contains</Text>
              <TextInput
                style={[styles.input, formErrors.messageBlockInput && styles.inputError]}
                placeholder="e.g., promo, marketing"
                placeholderTextColor={palette.textMuted}
                value={routeForm.messageBlockInput}
                onChangeText={value => updateForm('messageBlockInput', value)}
              />
              <Text style={styles.inputHint}>
                Comma-separated. If any phrase appears, the message is dropped. Case
                doesn't matter. Blocked phrases override includes.
              </Text>
              {formErrors.messageBlockInput ? (
                <Text style={styles.fieldError}>{formErrors.messageBlockInput}</Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  const renderRoutingStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Routing Rules</Text>
      <Text style={styles.stepDescription}>
        Choose who the OTP should come from, then decide whether message text should be
        optional extra filtering.
      </Text>

      {renderSenderSourceSelector()}

      {routeForm.senderSourceType === 'any' ? renderAnySenderHint() : null}
      {routeForm.senderSourceType === 'sender_id' ? renderManualSenderFields() : null}
      {routeForm.senderSourceType === 'contact' ? renderContactFields() : null}

      {renderMessageFilterSection()}
    </View>
  );

  const renderReviewStep = () => {
    const hasFilters =
      routeForm.useMessageFilters &&
      (parsePhraseList(routeForm.messageAllowInput).length > 0 ||
        parsePhraseList(routeForm.messageBlockInput).length > 0);
    const showAnySenderWarning = routeForm.senderSourceType === 'any' && !hasFilters;

    const senderEntries = parseSenderList(routeForm.senderPattern);
    const sourceLabel =
      routeForm.senderSourceType === 'any'
        ? 'Any sender on this device'
        : routeForm.senderSourceType === 'contact'
          ? routeForm.contactDisplayName || 'Saved contact'
          : senderEntries.length === 0
            ? 'Sender ID or number'
            : senderEntries.length === 1
              ? senderEntries[0]
              : `${senderEntries.length} senders (${senderEntries.join(', ')})`;

    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Review</Text>
        <Text style={styles.stepDescription}>
          Check the route in plain language before saving it. You can go back to adjust any
          part of the setup.
        </Text>

        {showAnySenderWarning ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>This forwards every OTP</Text>
            <Text style={styles.warningBody}>
              You picked "Any sender" without a message filter, so every OTP-shaped SMS
              that arrives on this device will be forwarded. Go back to step 4 to add a
              filter if you want to narrow it down.
            </Text>
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Plain-language summary</Text>
          <Text style={styles.summaryNarrative}>{buildRuleNarrative(routeForm)}</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Route Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Route Name</Text>
            <Text style={styles.summaryValue}>{routeForm.routeName || 'Not set'}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Destination</Text>
            <Text style={styles.summaryValue}>
              {buildTelegramDestinationName(routeForm.telegramChatId)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Source</Text>
            <Text style={styles.summaryValue}>{sourceLabel}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Message Rules</Text>
            <Text style={styles.summaryValue}>
              {routeForm.useMessageFilters
                ? [
                    routeForm.messageFilterMode !== 'exclude' &&
                      parsePhraseList(routeForm.messageAllowInput).length > 0
                      ? `Include ${parsePhraseList(routeForm.messageAllowInput).join(', ')}`
                      : null,
                    routeForm.messageFilterMode !== 'include' &&
                      parsePhraseList(routeForm.messageBlockInput).length > 0
                      ? `Exclude ${parsePhraseList(routeForm.messageBlockInput).join(', ')}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Enabled'
                : 'Any matched OTP'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderWizardStep = () => {
    switch (currentStep) {
      case 0:
        return renderRouteDetailsStep();
      case 1:
        return renderPermissionsStep();
      case 2:
        return renderTelegramStep();
      case 3:
        return renderRoutingStep();
      case 4:
        return renderReviewStep();
      default:
        return null;
    }
  };

  if (showWizard) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.wizardHeader}>
            <Pressable onPress={goBack} style={styles.backButton}>
              <Text style={styles.backText}>{currentStep === 0 ? 'Cancel' : 'Back'}</Text>
            </Pressable>
            <View style={styles.progressPills}>
              {stepLabels.map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.progressPill,
                    idx <= currentStep && styles.progressPillActive,
                  ]}
                />
              ))}
            </View>
            <View style={styles.placeholder} />
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.wizardScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {renderWizardStep()}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: 20 + insets.bottom }]}>
            <Pressable style={styles.primaryButton} onPress={goNext}>
              <Text style={styles.primaryButtonText}>
                {currentStep === stepLabels.length - 1 ? 'Complete Setup' : 'Continue'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const listenerDotColor = hasSmsPermission ? palette.success : palette.danger;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.homeHeader}>
        <Text style={styles.appTitle}>AuthRelay</Text>
        <View style={styles.listenerStatusRow}>
          <View style={[styles.statusDot, { backgroundColor: listenerDotColor }]} />
          <Text style={styles.statusText}>{listenerHealth}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={[
          styles.homeScrollContent,
          { paddingBottom: tabBarHeight + 16 },
        ]}
      >
        {!hasSmsPermission ? (
          <View style={styles.permissionBanner}>
            <Text style={styles.permissionBannerTitle}>SMS access required</Text>
            <Text style={styles.permissionBannerBody}>
              The listener cannot forward OTPs without permission to read incoming SMS.
            </Text>
            <Pressable
              style={styles.permissionBannerButton}
              onPress={handlePermissionRequest}
            >
              <Text style={styles.permissionBannerButtonText}>Grant SMS access</Text>
            </Pressable>
          </View>
        ) : null}

        {listenerStatus ? (
          <View style={styles.systemStatusCard}>
            <Text style={styles.cardEyebrow}>SYSTEM STATUS</Text>
            <View style={styles.systemStatusRow}>
              <Text style={styles.systemStatusLabel}>Battery optimization</Text>
              <Text
                style={[
                  styles.systemStatusValue,
                  !listenerStatus.ignoringBatteryOptimizations && styles.systemStatusValueWarn,
                ]}
              >
                {listenerStatus.ignoringBatteryOptimizations ? 'Unrestricted' : 'May terminate app'}
              </Text>
            </View>
            <View style={styles.systemStatusRow}>
              <Text style={styles.systemStatusLabel}>Autostart configured</Text>
              <Text style={styles.systemStatusValue}>
                {autostartAttempted ? 'Attempted — verify on device' : 'Not configured'}
              </Text>
            </View>
            {listenerStatus.bootRestoredAt > 0 ? (
              <View style={styles.systemStatusRow}>
                <Text style={styles.systemStatusLabel}>Last boot recovery</Text>
                <Text style={styles.systemStatusValue}>
                  {formatRelative(listenerStatus.bootRestoredAt)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>LATEST INTERCEPTION</Text>
          {latestEvent ? (
            <View style={styles.eventBox}>
              <Text style={styles.eventSender}>{latestEvent.sender}</Text>
              <Text style={styles.eventMessage}>{maskMessagePreview(latestEvent.message)}</Text>
              {(() => {
                const otp = extractOtp(latestEvent.message);
                return otp.maskedCode ? (
                  <Text style={styles.eventCode}>Code: {otp.maskedCode}</Text>
                ) : null;
              })()}
              <Text style={styles.eventTime}>Source: {latestEvent.source}</Text>
            </View>
          ) : (
            <Text style={styles.emptyState}>
              No messages intercepted yet. Background listener is running.
            </Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active Routes</Text>
          <Text style={styles.routeCount}>{rules.length} configured</Text>
        </View>

        {telegramStatus ? (
          <View style={styles.feedbackBanner}>
            <Text style={styles.feedbackBannerText}>{telegramStatus}</Text>
          </View>
        ) : null}

        {rules.length === 0 ? (
          <View style={styles.emptyRoutesContainer}>
            <View style={styles.emptyRouteCircle}>
              <Text style={styles.emptyRouteIcon}>+</Text>
            </View>
            <Text style={styles.emptyRouteTitle}>No routes set up</Text>
            <Text style={styles.emptyRouteText}>
              Create a route to automatically forward incoming OTPs to Telegram.
            </Text>
            <Pressable style={styles.primaryButton} onPress={startNewRoute}>
              <Text style={styles.primaryButtonText}>Create First Route</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.routesList}>
            {ruleViews.map(view => {
              const { rule, destination } = view;
              return (
                <View key={rule.id} style={styles.routeCard}>
                  <View style={styles.routeCardHeader}>
                    <Text style={styles.routeCardTitle}>{rule.routeName}</Text>
                    <View
                      style={[
                        styles.activeBadge,
                        !destination && styles.activeBadgeMissing,
                      ]}
                    >
                      <Text
                        style={[
                          styles.activeBadgeText,
                          !destination && styles.activeBadgeTextDanger,
                        ]}
                      >
                        {destination ? 'ACTIVE' : 'BROKEN'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.routeDetails}>
                    <View style={styles.routeDetailItem}>
                      <Text style={styles.detailLabel}>Source</Text>
                      <Text style={styles.detailValue}>{describeSenderRule(rule)}</Text>
                    </View>
                    <View style={styles.routeDetailItem}>
                      <Text style={styles.detailLabel}>Destination</Text>
                      <Text style={styles.detailValue}>
                        {getDestinationDisplayName(destination)}
                      </Text>
                    </View>
                    <View style={styles.routeDetailItem}>
                      <Text style={styles.detailLabel}>Message Rules</Text>
                      <Text style={styles.detailValue}>{summarizeFilters(rule)}</Text>
                    </View>
                  </View>

                  <View style={styles.separator} />

                  <View style={styles.routeActions}>
                    <Pressable
                      style={styles.actionButton}
                      onPress={() => { handleTestRule(view); }}
                      disabled={activeRuleId === rule.id || !destination}
                    >
                      <Text style={styles.actionButtonText}>
                        {activeRuleId === rule.id ? 'Sending...' : 'Test Route'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.actionButton, styles.deleteActionButton]}
                      onPress={() => handleDeleteRule(rule.id)}
                    >
                      <Text style={styles.deleteActionButtonText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}

            <Pressable style={styles.secondaryButton} onPress={startNewRoute}>
              <Text style={styles.secondaryButtonText}>+ Add Another Route</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  scrollArea: {
    flex: 1,
    paddingHorizontal: 20,
  },
  wizardScrollContent: {
    paddingBottom: 24,
  },
  homeScrollContent: {
    paddingTop: 0,
  },
  homeHeader: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: palette.panel,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  listenerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  permissionBanner: {
    marginTop: 20,
    padding: 16,
    backgroundColor: palette.dangerLight,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.danger,
  },
  permissionBannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: palette.danger,
    marginBottom: 4,
  },
  permissionBannerBody: {
    fontSize: 13,
    color: palette.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  permissionBannerButton: {
    alignSelf: 'flex-start',
    backgroundColor: palette.danger,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  permissionBannerButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  systemStatusCard: {
    backgroundColor: palette.panel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    marginTop: 16,
  },
  systemStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 12,
  },
  systemStatusLabel: {
    fontSize: 13,
    color: palette.textSecondary,
    fontWeight: '500',
    flex: 1,
  },
  systemStatusValue: {
    fontSize: 13,
    color: palette.textPrimary,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  systemStatusValueWarn: {
    color: palette.danger,
  },
  card: {
    backgroundColor: palette.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
    marginTop: 20,
  },
  cardEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  eventBox: {
    backgroundColor: palette.bg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.border,
  },
  eventSender: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 4,
  },
  eventMessage: {
    fontSize: 14,
    color: palette.textSecondary,
    lineHeight: 20,
    marginBottom: 8,
  },
  eventCode: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.textPrimary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  eventTime: {
    fontSize: 12,
    color: palette.textMuted,
  },
  emptyState: {
    fontSize: 14,
    color: palette.textMuted,
    fontStyle: 'italic',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  routeCount: {
    fontSize: 13,
    color: palette.textMuted,
    fontWeight: '600',
  },
  feedbackBanner: {
    backgroundColor: palette.accentLight,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  feedbackBannerText: {
    color: palette.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  emptyRoutesContainer: {
    backgroundColor: palette.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 32,
    alignItems: 'center',
  },
  emptyRouteCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyRouteIcon: {
    fontSize: 32,
    color: palette.textMuted,
    fontWeight: '300',
  },
  emptyRouteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 8,
  },
  emptyRouteText: {
    fontSize: 14,
    color: palette.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  routesList: {
    gap: 16,
  },
  routeCard: {
    backgroundColor: palette.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
  },
  routeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  routeCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.textPrimary,
    flex: 1,
  },
  activeBadge: {
    backgroundColor: palette.successLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeBadgeMissing: {
    backgroundColor: palette.dangerLight,
  },
  activeBadgeText: {
    color: palette.success,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  activeBadgeTextDanger: {
    color: palette.danger,
  },
  routeDetails: {
    gap: 12,
  },
  routeDetailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  detailLabel: {
    fontSize: 14,
    color: palette.textSecondary,
    flex: 1,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  routeActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  actionButton: {
    backgroundColor: palette.accentLight,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  actionButtonText: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  deleteActionButton: {
    backgroundColor: palette.dangerLight,
    borderWidth: 1,
    borderColor: palette.danger,
  },
  deleteActionButtonText: {
    color: palette.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  wizardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.panel,
  },
  backButton: {
    paddingVertical: 8,
  },
  backText: {
    color: palette.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  placeholder: {
    width: 50,
  },
  progressPills: {
    flexDirection: 'row',
    gap: 6,
  },
  progressPill: {
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
  },
  progressPillActive: {
    backgroundColor: palette.accent,
  },
  stepContent: {
    paddingVertical: 24,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  stepDescription: {
    fontSize: 15,
    color: palette.textSecondary,
    lineHeight: 22,
    marginBottom: 24,
  },
  inputWrapper: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textPrimary,
    marginBottom: 8,
    marginLeft: 4,
  },
  input: {
    backgroundColor: palette.inputBg,
    borderWidth: 1,
    borderColor: palette.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: palette.textPrimary,
  },
  inputHint: {
    fontSize: 12,
    color: palette.textMuted,
    marginTop: 6,
    marginLeft: 4,
    lineHeight: 18,
  },
  permissionCard: {
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  permissionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  permissionTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  permissionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: palette.textPrimary,
    marginBottom: 2,
  },
  permissionSubtitle: {
    fontSize: 13,
    color: palette.textMuted,
    lineHeight: 18,
  },
  permissionHint: {
    fontSize: 12,
    color: palette.success,
    marginTop: 4,
    fontWeight: '600',
  },
  separator: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: 16,
  },
  summaryCard: {
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  summaryBody: {
    fontSize: 14,
    color: palette.textSecondary,
    lineHeight: 20,
  },
  summaryNarrative: {
    fontSize: 15,
    color: palette.textPrimary,
    lineHeight: 22,
    fontWeight: '500',
  },
  summaryValueBlock: {
    fontSize: 15,
    color: palette.textPrimary,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 16,
  },
  summaryLabel: {
    fontSize: 14,
    color: palette.textSecondary,
    flex: 1,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  footer: {
    padding: 20,
    backgroundColor: palette.bg,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  primaryButton: {
    backgroundColor: palette.accent,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: palette.panel,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  },
  secondaryButtonText: {
    color: palette.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  autostartButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: palette.accent,
  },
  autostartButtonPressed: {
    opacity: 0.7,
  },
  autostartButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  inlineButton: {
    alignSelf: 'flex-start',
    backgroundColor: palette.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  inputError: {
    borderColor: palette.danger,
  },
  fieldError: {
    color: palette.danger,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    marginLeft: 4,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  segmentButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: palette.panel,
  },
  segmentButtonActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentLight,
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textSecondary,
    textAlign: 'center',
  },
  segmentButtonTextActive: {
    color: palette.textPrimary,
  },
  advancedModeButton: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: palette.panel,
    marginBottom: 16,
  },
  contactSection: {
    gap: 16,
  },
  selectedContactCard: {
    backgroundColor: palette.successLight,
    borderWidth: 1,
    borderColor: palette.success,
    borderRadius: 12,
    padding: 14,
  },
  selectedContactTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 4,
  },
  selectedContactMeta: {
    fontSize: 13,
    color: palette.textSecondary,
  },
  contactList: {
    gap: 12,
  },
  contactCard: {
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 14,
  },
  contactCardSelected: {
    borderColor: palette.accent,
    backgroundColor: palette.accentLight,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '600',
    color: palette.textPrimary,
    marginBottom: 4,
  },
  contactMeta: {
    fontSize: 13,
    color: palette.textSecondary,
  },
  messageRulesSection: {
    marginTop: 8,
    gap: 16,
  },
  // Three-option sender source list
  sourceList: {
    gap: 10,
    marginTop: 8,
  },
  sourceOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.panel,
    gap: 12,
  },
  sourceOptionActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentLight,
  },
  sourceRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  sourceRadioActive: {
    borderColor: palette.accent,
  },
  sourceRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.accent,
  },
  sourceTextWrap: {
    flex: 1,
  },
  sourceOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 4,
  },
  sourceOptionSubtitle: {
    fontSize: 13,
    color: palette.textSecondary,
    lineHeight: 18,
  },
  // System contact picker
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.accent,
    borderStyle: 'dashed',
    backgroundColor: palette.panel,
  },
  pickerButtonPressed: {
    opacity: 0.7,
  },
  pickerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerIcon: {
    fontSize: 22,
    fontWeight: '300',
    color: palette.accent,
  },
  pickerTextWrap: {
    flex: 1,
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 2,
  },
  pickerSubtitle: {
    fontSize: 13,
    color: palette.textSecondary,
    lineHeight: 18,
  },
  selectedContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  selectedContactTextWrap: {
    flex: 1,
  },
  inlineButtonPressed: {
    opacity: 0.7,
  },
  // Any-sender + review warning
  warningCard: {
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.danger,
    backgroundColor: palette.dangerLight,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: palette.danger,
    marginBottom: 4,
  },
  warningBody: {
    fontSize: 13,
    color: palette.textSecondary,
    lineHeight: 18,
  },
});
