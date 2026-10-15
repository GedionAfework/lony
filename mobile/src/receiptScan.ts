import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { api } from './api';

export type ReceiptExtractDraft = {
  kind: 'income' | 'expense';
  title: string;
  amount: string;
  currency_code: string;
  note?: string;
  occurred_at?: string;
  merchant?: string;
  matched_entry_id?: string;
  partial?: boolean;
};

/**
 * Open the camera, send the photo to AI receipt scan, and return a draft for the
 * expense form (create: false). Always prefers opening the form with whatever
 * the model returned so the user can save / split with friends without typing from scratch.
 */
export async function scanReceiptWithCamera(
  token: string,
  accountId?: string,
): Promise<ReceiptExtractDraft | null> {
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) {
    Alert.alert('Camera permission', 'Allow camera access to scan receipts and statements.');
    return null;
  }

  const pick = await ImagePicker.launchCameraAsync({
    // Smaller images are more reliable for vision APIs (Groq 20MB / token limits).
    quality: 0.45,
    base64: true,
    allowsEditing: false,
    exif: false,
  });
  if (pick.canceled || !pick.assets?.[0]?.base64) return null;

  const asset = pick.assets[0];
  let res;
  try {
    res = await api.scanCashflowReceipt(token, {
      mime: asset.mimeType || 'image/jpeg',
      image_base64: asset.base64!,
      account_id: accountId,
      create: false,
    });
  } catch (e) {
    Alert.alert('Receipt scan failed', e instanceof Error ? e.message : 'Could not read receipt');
    return null;
  }

  const e = res.extract;
  const amount = (e.amount || '').trim();
  const title = (e.title || e.merchant || 'Receipt').trim();
  const kind = e.kind === 'income' ? 'income' : 'expense';
  const draft: ReceiptExtractDraft = {
    kind,
    title,
    amount,
    currency_code: (e.currency_code || '').trim().toUpperCase(),
    note: e.note || (e.merchant && e.merchant !== title ? e.merchant : undefined),
    occurred_at: e.occurred_at,
    merchant: e.merchant,
    matched_entry_id: e.matched_entry_id,
    partial: !amount,
  };

  if (!amount) {
    Alert.alert(
      'Couldn’t read the amount',
      'We opened the expense form with what we could extract. Fill the amount, then save — or share with friends.',
    );
  }

  return draft;
}
