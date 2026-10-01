import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { api, type CashflowEntry } from './api';

/** Open the camera, send the photo to AI receipt scan, and create a cashflow entry. */
export async function scanReceiptWithCamera(
  token: string,
  accountId?: string,
): Promise<CashflowEntry | null> {
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) {
    Alert.alert('Camera permission', 'Allow camera access to scan receipts and statements.');
    return null;
  }

  const pick = await ImagePicker.launchCameraAsync({
    quality: 0.75,
    base64: true,
    allowsEditing: true,
  });
  if (pick.canceled || !pick.assets?.[0]?.base64) return null;

  const asset = pick.assets[0];
  const res = await api.scanCashflowReceipt(token, {
    mime: asset.mimeType || 'image/jpeg',
    image_base64: asset.base64!,
    account_id: accountId,
    create: true,
  });

  if (!res.entry) {
    const e = res.extract;
    Alert.alert(
      'Could not save receipt',
      [
        e.title || e.merchant,
        e.amount ? `${e.amount} ${e.currency_code || ''}`.trim() : null,
        'Try again with a clearer photo.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return null;
  }

  const e = res.extract;
  Alert.alert(
    'Receipt saved',
    [res.entry.title, `${res.entry.amount} ${res.entry.currency_code}`, e.matched_entry_id ? 'Matched an expected bill.' : null]
      .filter(Boolean)
      .join('\n'),
  );
  return res.entry;
}
