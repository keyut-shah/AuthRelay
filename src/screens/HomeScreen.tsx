import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
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
import type { IncomingSmsEvent } from '../native/smsRouter';
import {
  doesRouteMatchSender,
  forwardSmsToTelegramRoute,
  sendTelegramMessage,
} from '../services/telegram';
import { StorageHelpers } from '../storage';
import { palette } from '../theme';
import type { ReceiverForm, SmsEventPreview, StoredRoute } from '../types';

const stepLabels = ['Overview', 'Permissions', 'Telegram', 'Routing'];

const initialForm: ReceiverForm = {
  teamName: '',
  telegramName: '',
  telegramBotToken: '',
  telegramChatId: '',
  senderFilter: '',
};

export function HomeScreen() {
  const [routes, setRoutes] = useState<StoredRoute[]>(StorageHelpers.getRoutes());
  const [showWizard, setShowWizard] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // Permissions & Settings
  const [hasSmsPermission, setHasSmsPermission] = useState(false);
  const [ignoreBatteryOptimizations, setIgnoreBatteryOptimizations] = useState(false);
  const [allowAutostart, setAllowAutostart] = useState(false);

  // Form State
  const [receiverForm, setReceiverForm] = useState(initialForm);

  // Listener & Events
  const [listenerHealth, setListenerHealth] = useState('Checking listener status...');
  const [latestEvent, setLatestEvent] = useState<SmsEventPreview | null>(null);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);

  const forwardIncomingSms = async (event: IncomingSmsEvent) => {
    const latestRoutes = StorageHelpers.getRoutes();
    const matchingRoutes = latestRoutes.filter(route =>
      doesRouteMatchSender(route, event.sender),
    );

    if (matchingRoutes.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      matchingRoutes.map(route => forwardSmsToTelegramRoute(route, event)),
    );

    const deliveredCount = results.filter(result => result.status === 'fulfilled').length;
    const failedResult = results.find(result => result.status === 'rejected');

    if (failedResult?.status === 'rejected') {
      const message =
        failedResult.reason instanceof Error
          ? failedResult.reason.message
          : 'Unable to forward message to Telegram.';
      setTelegramStatus(`Telegram forward failed: ${message}`);
      return;
    }

    setTelegramStatus(`Forwarded to ${deliveredCount} Telegram route${deliveredCount === 1 ? '' : 's'}.`);
  };

  useEffect(() => {
    // 1. Check existing SMS permission state so toggle reflects reality
    const checkPermissions = async () => {
      if (Platform.OS !== 'android') return;
      const receive = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      );
      const read = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_SMS,
      );
      if (receive && read) {
        setHasSmsPermission(true);
      } else {
        // Auto-prompt on first launch so user sees the system dialog immediately
        const granted = await requestSmsPermission();
        setHasSmsPermission(granted);
      }
    };

    checkPermissions();

    // 2. Load listener status from the native bridge
    const loadListenerStatus = async () => {
      const status = await getListenerStatus();
      if (!status) {
        setListenerHealth('Listener disconnected');
        return;
      }
      setListenerHealth(
        status.bootRecoveryEnabled
          ? 'Active (Boot recovery enabled)'
          : 'Active (Pending boot recovery)',
      );
    };

    loadListenerStatus().catch(() => {
      setListenerHealth('Unable to verify listener status');
    });

    // 3. Subscribe to live SMS events
    const subscription = subscribeToIncomingSms(event => {
      setLatestEvent(event);
      forwardIncomingSms(event).catch(error => {
        const message =
          error instanceof Error ? error.message : 'Unable to forward message to Telegram.';
        setTelegramStatus(`Telegram forward failed: ${message}`);
      });
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const canFinishSetup =
    hasSmsPermission &&
    receiverForm.teamName.trim().length > 0 &&
    receiverForm.telegramName.trim().length > 0 &&
    receiverForm.telegramBotToken.trim().length > 0 &&
    receiverForm.telegramChatId.trim().length > 0 &&
    receiverForm.senderFilter.trim().length > 0;

  const updateForm = <K extends keyof ReceiverForm>(key: K, value: ReceiverForm[K]) => {
    setReceiverForm(prev => ({ ...prev, [key]: value }));
  };

  const startNewRoute = () => {
    setReceiverForm(initialForm);
    setCurrentStep(0);
    setShowWizard(true);
  };

  const finishSetup = () => {
    if (!canFinishSetup) return;
    const updatedRoutes = [
      ...routes,
      {
        ...receiverForm,
        id: `route_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      },
    ];
    setRoutes(updatedRoutes);
    StorageHelpers.saveRoutes(updatedRoutes);
    setReceiverForm(initialForm);
    setShowWizard(false);
  };

  const goNext = () => {
    if (currentStep < stepLabels.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      finishSetup();
    }
  };

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    } else {
      setShowWizard(false);
    }
  };

  const handlePermissionRequest = async () => {
    const granted = await requestSmsPermission();
    setHasSmsPermission(granted);
    if (!granted) {
      Alert.alert('Permission Required', 'SMS access is mandatory for OTP forwarding.');
    }
  };

  const handleSimulation = async (route: StoredRoute) => {
    const sender = route.senderFilter || 'TEST-SENDER';
    const team = route.teamName || 'Ops';
    setActiveRouteId(route.id);
    setTelegramStatus(`Sending Telegram test for ${route.teamName}...`);

    try {
      await sendTelegramMessage(
        route.telegramBotToken,
        route.telegramChatId,
        [
          `AuthRelay test route for ${team}`,
          '',
          `Sender filter: ${sender}`,
          `Destination: ${route.telegramName}`,
          '',
          'If you received this, your Telegram bot token and chat ID are working.',
        ].join('\n'),
      );
      setTelegramStatus(`Telegram test sent successfully for ${route.teamName}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to send test message to Telegram.';
      Alert.alert('Telegram Test Failed', message);
      setTelegramStatus(`Telegram test failed for ${route.teamName}: ${message}`);
      return;
    } finally {
      setActiveRouteId(null);
    }

    simulateIncomingSms(
      sender,
      `Your ${team} code is 123456. Never share this code with anyone.`
    );
  };

  const handleDeleteRoute = (routeId: string) => {
    const updatedRoutes = StorageHelpers.removeRoute(routeId);
    setRoutes(updatedRoutes);
  };

  const renderWizardStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Team Identifier</Text>
            <Text style={styles.stepDescription}>
              Name the team or department this device will forward OTPs to. This helps organize multiple forwarding devices.
            </Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Team Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Engineering, Finance"
                placeholderTextColor={palette.textMuted}
                value={receiverForm.teamName}
                onChangeText={val => updateForm('teamName', val)}
              />
            </View>
          </View>
        );
      case 1:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>System Access</Text>
            <Text style={styles.stepDescription}>
              To reliably forward messages, AuthRelay needs background execution and SMS permissions.
            </Text>
            
            <View style={styles.permissionCard}>
              <View style={styles.permissionHeader}>
                <View>
                  <Text style={styles.permissionTitle}>Read SMS</Text>
                  <Text style={styles.permissionSubtitle}>Required to capture OTPs</Text>
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
                <View>
                  <Text style={styles.permissionTitle}>Battery Unrestricted</Text>
                  <Text style={styles.permissionSubtitle}>Prevents app termination</Text>
                </View>
                <Switch
                  value={ignoreBatteryOptimizations}
                  onValueChange={setIgnoreBatteryOptimizations}
                  trackColor={{ false: palette.border, true: palette.accent }}
                  thumbColor={palette.panel}
                />
              </View>
              
              <View style={styles.separator} />
              
              <View style={styles.permissionHeader}>
                <View>
                  <Text style={styles.permissionTitle}>Auto-start (OEM)</Text>
                  <Text style={styles.permissionSubtitle}>Required on some Androids</Text>
                </View>
                <Switch
                  value={allowAutostart}
                  onValueChange={setAllowAutostart}
                  trackColor={{ false: palette.border, true: palette.accent }}
                  thumbColor={palette.panel}
                />
              </View>
            </View>
          </View>
        );
      case 2:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Telegram Configuration</Text>
            <Text style={styles.stepDescription}>
              Provide the credentials for the Telegram bot that will dispatch the messages.
            </Text>
            
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Receiver Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Auth Alerts Bot"
                placeholderTextColor={palette.textMuted}
                value={receiverForm.telegramName}
                onChangeText={val => updateForm('telegramName', val)}
              />
            </View>
            
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Bot Token</Text>
              <TextInput
                style={styles.input}
                placeholder="123456789:AA..."
                placeholderTextColor={palette.textMuted}
                value={receiverForm.telegramBotToken}
                onChangeText={val => updateForm('telegramBotToken', val)}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>
            
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Chat ID</Text>
              <TextInput
                style={styles.input}
                placeholder="-10012345678"
                placeholderTextColor={palette.textMuted}
                value={receiverForm.telegramChatId}
                onChangeText={val => updateForm('telegramChatId', val)}
                autoCapitalize="none"
              />
            </View>
          </View>
        );
      case 3:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Routing Rules</Text>
            <Text style={styles.stepDescription}>
              Define which messages should be forwarded based on the sender's ID.
            </Text>
            
            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Allowed Sender</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., AWS, GITHUB, BANK"
                placeholderTextColor={palette.textMuted}
                value={receiverForm.senderFilter}
                onChangeText={val => updateForm('senderFilter', val)}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Route Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>From</Text>
                <Text style={styles.summaryValue}>{receiverForm.senderFilter || 'Any'}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>To</Text>
                <Text style={styles.summaryValue}>Telegram ({receiverForm.telegramName || 'Unnamed'})</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Owner</Text>
                <Text style={styles.summaryValue}>{receiverForm.teamName || 'Unknown'}</Text>
              </View>
            </View>
          </View>
        );
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
              <Text style={styles.backText}>Cancel</Text>
            </Pressable>
            <View style={styles.progressPills}>
              {stepLabels.map((_, idx) => (
                <View 
                  key={idx} 
                  style={[
                    styles.progressPill, 
                    idx <= currentStep && styles.progressPillActive
                  ]} 
                />
              ))}
            </View>
            <View style={styles.placeholder} />
          </View>

          <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
            {renderWizardStep()}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable 
              style={[
                styles.primaryButton,
                currentStep === 3 && !canFinishSetup && styles.buttonDisabled
              ]} 
              onPress={goNext}
            >
              <Text style={styles.primaryButtonText}>
                {currentStep === 3 ? 'Complete Setup' : 'Continue'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // HOME DASHBOARD VIEW
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.homeHeader}>
        <Text style={styles.appTitle}>AuthRelay</Text>
        <View style={styles.listenerStatusRow}>
          <View style={[styles.statusDot, { backgroundColor: palette.success }]} />
          <Text style={styles.statusText}>{listenerHealth}</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.homeScrollContent}>
        
        {/* Latest Event Card */}
        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>LATEST INTERCEPTION</Text>
          {latestEvent ? (
            <View style={styles.eventBox}>
              <Text style={styles.eventSender}>{latestEvent.sender}</Text>
              <Text style={styles.eventMessage}>{latestEvent.message}</Text>
              <Text style={styles.eventTime}>Source: {latestEvent.source}</Text>
            </View>
          ) : (
            <Text style={styles.emptyState}>No messages intercepted yet. Background listener is running.</Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active Routes</Text>
          <Text style={styles.routeCount}>{routes.length} configured</Text>
        </View>

        {telegramStatus ? (
          <View style={styles.feedbackBanner}>
            <Text style={styles.feedbackBannerText}>{telegramStatus}</Text>
          </View>
        ) : null}

        {routes.length === 0 ? (
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
            {routes.map(route => (
              <View key={route.id} style={styles.routeCard}>
                <View style={styles.routeCardHeader}>
                  <Text style={styles.routeCardTitle}>{route.teamName}</Text>
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>ACTIVE</Text>
                  </View>
                </View>
                
                <View style={styles.routeDetails}>
                  <View style={styles.routeDetailItem}>
                    <Text style={styles.detailLabel}>Sender</Text>
                    <Text style={styles.detailValue}>{route.senderFilter}</Text>
                  </View>
                  <View style={styles.routeDetailItem}>
                    <Text style={styles.detailLabel}>Destination</Text>
                    <Text style={styles.detailValue}>Telegram ({route.telegramName})</Text>
                  </View>
                </View>
                
                <View style={styles.separator} />
                
                <View style={styles.routeActions}>
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => handleSimulation(route)}
                    disabled={activeRouteId === route.id}
                  >
                    <Text style={styles.actionButtonText}>
                      {activeRouteId === route.id ? 'Sending...' : 'Test Route'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionButton, styles.deleteActionButton]}
                    onPress={() => handleDeleteRoute(route.id)}
                  >
                    <Text style={styles.actionButtonText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            
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
  homeScrollContent: {
    paddingBottom: 40,
  },
  // Home Header
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
  // Home Content
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
  card: {
    backgroundColor: palette.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
    marginTop: 20,
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
  eventTime: {
    fontSize: 12,
    color: palette.textMuted,
  },
  emptyState: {
    fontSize: 14,
    color: palette.textMuted,
    fontStyle: 'italic',
  },
  // Empty Routes
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
  // Routes List
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
  },
  routeCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  activeBadge: {
    backgroundColor: palette.successLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeBadgeText: {
    color: palette.success,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  routeDetails: {
    gap: 12,
  },
  routeDetailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  deleteActionButton: {
    backgroundColor: '#3a1620',
  },
  actionButtonText: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  // Wizard Header
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
  // Wizard Content
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
    marginBottom: 32,
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
  // Permissions
  permissionCard: {
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 16,
  },
  permissionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  },
  separator: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: 16,
  },
  // Summary
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
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: palette.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  // Footer
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
  buttonDisabled: {
    opacity: 0.5,
  },
  detailLabel: {
    fontSize: 14,
    color: palette.textSecondary,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.textPrimary,
  },
});
