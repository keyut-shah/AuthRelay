import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

export type ListenerStatus = {
  receiverRegistered: boolean;
  bootRecoveryEnabled: boolean;
  foregroundServiceEnabled: boolean;
  ignoringBatteryOptimizations: boolean;
  /** ms epoch of the last BOOT_COMPLETED warm-up. 0 means never. */
  bootRestoredAt: number;
  /** ms epoch of the last time the user opened the autostart settings. 0 means never. */
  autostartAttemptedAt: number;
};

export type IncomingSmsEvent = {
  sender: string;
  message: string;
  source: string;
  receivedAt: number;
};

type SmsRouterNativeModule = {
  getListenerStatus(): Promise<ListenerStatus>;
  simulateIncomingSms(sender: string, message: string): void;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<boolean>;
  openAutostartSettings(): Promise<boolean>;
};

const { SmsRouterModule } = NativeModules as {
  SmsRouterModule?: SmsRouterNativeModule;
};

const eventEmitter = SmsRouterModule
  ? new NativeEventEmitter(SmsRouterModule as never)
  : null;

export async function checkSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
}

export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function getListenerStatus(): Promise<ListenerStatus | null> {
  if (!SmsRouterModule) return null;
  return SmsRouterModule.getListenerStatus();
}

export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (!SmsRouterModule) return false;
  return SmsRouterModule.isIgnoringBatteryOptimizations();
}

/**
 * Opens the system "ignore battery optimizations" dialog if needed.
 * Resolves to `true` when the app is *already* exempt (no dialog shown).
 */
export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  if (!SmsRouterModule) return false;
  return SmsRouterModule.requestIgnoreBatteryOptimizations();
}

/**
 * Tries to open the OEM's autostart manager Activity (Xiaomi/Oppo/Vivo/etc).
 * Resolves to `true` if a known vendor intent was launched, `false` if we
 * had to fall back to the app-details screen. The state cannot be detected
 * — the caller should record that the operator attempted it.
 */
export async function openAutostartSettings(): Promise<boolean> {
  if (!SmsRouterModule) return false;
  return SmsRouterModule.openAutostartSettings();
}

export function simulateIncomingSms(sender: string, message: string) {
  SmsRouterModule?.simulateIncomingSms(sender, message);
}

export function subscribeToIncomingSms(
  listener: (event: IncomingSmsEvent) => void,
) {
  if (!eventEmitter) {
    return { remove: () => undefined };
  }
  return eventEmitter.addListener('otpRouter:smsReceived', listener);
}

/**
 * Fires whenever the native dispatcher appends a ProcessedMessageEvent
 * to MMKV (after every send / failed / ignored outcome). The listener
 * should reload the event list from storage.
 */
export function subscribeToEventHistoryUpdated(listener: () => void) {
  if (!eventEmitter) {
    return { remove: () => undefined };
  }
  return eventEmitter.addListener('otpRouter:eventHistoryUpdated', listener);
}
