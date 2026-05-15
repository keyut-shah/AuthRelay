/* eslint-env jest */
require('react-native-gesture-handler/jestSetup');

jest.mock('react-native-screens', () => {
  const RealComponent = jest.requireActual('react-native-screens');
  RealComponent.enableScreens = () => undefined;
  return RealComponent;
});
