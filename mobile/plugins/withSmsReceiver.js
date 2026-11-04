// Adds the incoming-SMS receiver (plugins/sms-receiver/*.kt) to the Android app, so a
// fresh `expo prebuild` keeps it. The committed android/ folder already contains it.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const PACKAGE_DIR = ['app', 'src', 'main', 'java', 'io', 'lony', 'app'];
const FILES = ['SmsReceiver.kt', 'SmsHeadlessTaskService.kt'];

function withSmsReceiverManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.receiver = (app.receiver || []).filter((r) => r.$['android:name'] !== '.SmsReceiver');
    app.receiver.push({
      $: {
        'android:name': '.SmsReceiver',
        'android:exported': 'true',
        'android:permission': 'android.permission.BROADCAST_SMS',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } }] }],
    });
    app.service = (app.service || []).filter((s) => s.$['android:name'] !== '.SmsHeadlessTaskService');
    app.service.push({ $: { 'android:name': '.SmsHeadlessTaskService', 'android:exported': 'false' } });
    return cfg;
  });
}

function withSmsReceiverSources(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const dest = path.join(cfg.modRequest.platformProjectRoot, ...PACKAGE_DIR);
      fs.mkdirSync(dest, { recursive: true });
      for (const file of FILES) {
        fs.copyFileSync(path.join(__dirname, 'sms-receiver', file), path.join(dest, file));
      }
      return cfg;
    },
  ]);
}

module.exports = function withSmsReceiver(config) {
  return withSmsReceiverSources(withSmsReceiverManifest(config));
};
