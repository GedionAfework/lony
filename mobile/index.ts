import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import App from './App';
import { handleIncomingSms } from './src/smsIncoming';

// Incoming bank SMS, delivered by the native SmsReceiver even when the app is closed.
AppRegistry.registerHeadlessTask('LonySmsReceived', () => handleIncomingSms);

registerRootComponent(App);
