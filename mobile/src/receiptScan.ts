import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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

/** Camera or gallery: a receipt is often already a screenshot or a saved photo. */
function chooseSource(): Promise<'camera' | 'library' | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Scan a receipt',
      'Take a photo, or pick a receipt or statement you already have.',
      [
        { text: 'Take photo', onPress: () => resolve('camera') },
        { text: 'Choose from gallery', onPress: () => resolve('library') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/**
 * Phone photos are 3,000–4,000px wide: far more than reading needs, and over the AI's
 * size limit once encoded. 1,600px keeps small print sharp and the upload well under 1MB.
 */
async function shrinkForReading(uri: string, width?: number): Promise<string | null> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    if (!width || width > 1600) ctx.resize({ width: 1600 });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
    return out.base64 || null;
  } catch {
    return null;
  }
}

/**
 * Open the camera, send the photo to AI receipt scan, and return a draft for the
 * expense form (create: false). Always prefers opening the form with whatever
 * the model returned so the user can save / split with friends without typing from scratch.
 */
export async function scanReceiptWithCamera(
  token: string,
  accountId?: string,
): Promise<ReceiptExtractDraft | null> {
  const source = await chooseSource();
  if (!source) return null;

  let pick: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      Alert.alert('Camera permission', 'Allow camera access to scan receipts and statements.');
      return null;
    }
    pick = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false, exif: false });
  } else {
    pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: false, exif: false });
  }
  if (pick.canceled || !pick.assets?.[0]?.uri) return null;

  const image = await shrinkForReading(pick.assets[0].uri, pick.assets[0].width);
  if (!image) {
    Alert.alert('Receipt scan failed', 'Could not open that picture. Try another one.');
    return null;
  }

  let res;
  try {
    res = await api.scanCashflowReceipt(token, {
      mime: 'image/jpeg',
      image_base64: image,
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
