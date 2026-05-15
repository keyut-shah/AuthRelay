import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

type ListenerStatus = {
  receiverRegistered: boolean;
  bootRecoveryEnabled: boolean;
  foregroundServiceEnabled: boolean;
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
};

const { SmsRouterModule } = NativeModules as {
  SmsRouterModule?: SmsRouterNativeModule;
};

const eventEmitter = SmsRouterModule
  ? new NativeEventEmitter(SmsRouterModule as never)
  : null;

export async function requestSmsPermission() {
  if (Platform.OS !== 'android') {
    return false;
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function getListenerStatus(): Promise<ListenerStatus | null> {
  if (!SmsRouterModule) {
    return null;
  }

  return SmsRouterModule.getListenerStatus();
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
