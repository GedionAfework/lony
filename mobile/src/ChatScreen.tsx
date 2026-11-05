import {
  AudioModule,
  createAudioPlayer,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from './audioChat';
import * as DocumentPicker from 'expo-document-picker';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  api,
  type ChatMessage,
  type Conversation,
  type ConversationMoney,
} from './api';
import { formatMoney } from './amountFormat';
import { t } from './i18n';
import { mergeMessages } from './chatSync';
import { ActionSheet, type SheetRequest } from './ActionSheet';
import { apiBaseUrl, fonts, useTheme, type ThemeColors } from './theme';
import { AuthenticatedAvatar, AuthenticatedImage, prefetchAvatars } from './AuthenticatedAvatar';
import { IconAttach, IconBack, IconEmoji, IconLoans, IconMic, IconSend } from './icons';

type ChatPeer = { id: string; display_name: string; username?: string | null; avatar_url?: string | null };

/** Last chat list and threads seen this session: reopening shows them at once, then refreshes. */
let listCache: Conversation[] = [];
const threadCache = new Map<string, ChatMessage[]>();

/** A text message on its way to the server; shown right away, retried on tap if it failed. */
type Outgoing = { tmpId: string; convId: string; body: string; replyTo: ChatMessage | null; createdAt: string; failed: boolean };

/** "Today", "Yesterday", or a date, for the separators between days. */
function dayLabel(iso: string, locale?: string | null): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(locale || undefined, {
    weekday: diff < 7 ? 'long' : undefined,
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function mmss(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];
const COMPOSER_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅',
  '😭', '😡', '👍', '👎', '❤️', '🔥', '🙏', '👏', '🎉', '✅',
  '💯', '🤝', '💪', '✨', '📌', '💰', '🏦', '📱',
];

type Props = {
  token: string;
  userId: string;
  selfInitial: string;
  selfAvatarUrl?: string | null;
  selfAvatarLocalUri?: string | null;
  locale?: string | null;
  friends: { peer: ChatPeer }[];
  openLoanId?: string | null;
  openPeerId?: string | null;
  onLoanOpened?: () => void;
  onPeerOpened?: () => void;
  onError: (message: string) => void;
  onOpenProfile?: (peer: ChatPeer) => void;
  onCreateLoanWith?: (peer: { id: string; display_name: string }) => void;
  onOpenLoan?: (loanId: string) => void;
  onActiveChange?: (active: boolean) => void;
  /** Unread messages across all chats, for the Chats tab badge. */
  onUnreadChange?: (count: number) => void;
};

export function ChatScreen({
  token,
  userId,
  selfInitial,
  selfAvatarUrl,
  selfAvatarLocalUri,
  locale,
  friends,
  openLoanId,
  openPeerId,
  onLoanOpened,
  onPeerOpened,
  onError,
  onOpenProfile,
  onCreateLoanWith,
  onOpenLoan,
  onActiveChange,
  onUnreadChange,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 200);
  const [conversations, setConversations] = useState<Conversation[]>(() => listCache);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reactFor, setReactFor] = useState<string | null>(null);
  // In-app sheet for menus and delete confirmations (never the phone's system pop-up).
  const [sheet, setSheet] = useState<SheetRequest | null>(null);
  const sheetEl = <ActionSheet request={sheet} onClose={() => setSheet(null)} />;
  const listRef = useRef<FlatList<ChatMessage>>(null);
  // Server cursor for "what changed since". Only fetches move it, never our own sends,
  // so a message the other person sent a moment earlier is never skipped.
  const cursor = useRef<string | undefined>(undefined);
  const peerReadAt = useRef<string | null>(null);
  // The thread currently on screen; late replies for any other thread are dropped.
  const activeId = useRef<string | undefined>(undefined);
  const scrolledToNewest = useRef<string | undefined>(undefined);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const recordStartedAt = useRef<number>(0);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const [recordMs, setRecordMs] = useState(0);

  // Remember each thread so reopening it is instant.
  useEffect(() => {
    if (active && messages.length) threadCache.set(active.id, messages);
  }, [active, messages]);

  // A running clock while recording a voice note.
  useEffect(() => {
    if (!recorderState.isRecording) {
      setRecordMs(0);
      return;
    }
    const id = setInterval(() => setRecordMs(Date.now() - (recordStartedAt.current || Date.now())), 250);
    return () => clearInterval(id);
  }, [recorderState.isRecording]);

  // Stop any voice note when leaving the screen.
  useEffect(() => () => playerRef.current?.remove(), []);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    return () => sub.remove();
  }, []);

  function isSelfConversation(c: Conversation) {
    return c.peer.id === userId || c.peer.display_name === 'Self' || c.peer.display_name === 'Saved Messages';
  }

  // The Chats tab badge counts unread messages, never notifications.
  useEffect(() => {
    onUnreadChange?.(conversations.filter((c) => !isSelfConversation(c)).reduce((n, c) => n + (c.unread_count || 0), 0));
  }, [conversations]);

  async function loadConversations() {
    const res = await api.listConversations(token);
    let list = res.conversations ?? [];
    // The open chat is being read right now, so it has nothing unread.
    if (activeId.current) list = list.map((c) => (c.id === activeId.current ? { ...c, unread_count: 0 } : c));
    listCache = list;
    setConversations(list);
    prefetchAvatars(list.map((c) => c.peer.avatar_url), token);
    setActive((prev) => {
      if (!prev) {
        return prev;
      }
      return list.find((c) => c.id === prev.id) ?? prev;
    });
  }

  // Shows a thread from its newest messages. Ignored if another thread was opened meanwhile.
  async function loadThread(conv: Conversation) {
    activeId.current = conv.id;
    setConversations((list) => list.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)));
    cursor.current = undefined;
    peerReadAt.current = null;
    scrolledToNewest.current = undefined;
    setActive(conv);
    setMessages(threadCache.get(conv.id) ?? []);
    setHasOlder(false);
    setReactFor(null);
    const page = await api.listMessages(token, conv.id);
    if (activeId.current !== conv.id) {
      return;
    }
    cursor.current = page.cursor;
    peerReadAt.current = page.peer_read_at ?? null;
    setMessages((prev) => mergeMessages(prev.length ? prev : [], page.messages ?? [], page.peer_read_at));
    setHasOlder(page.has_more);
  }

  function closeThread() {
    activeId.current = undefined;
    cursor.current = undefined;
    setActive(null);
    setMessages([]);
    setHasOlder(false);
  }

  async function loadOlder() {
    if (!active || loadingOlder || messages.length === 0) {
      return;
    }
    const convId = active.id;
    const first = messages[0];
    setLoadingOlder(true);
    try {
      const page = await api.listMessages(token, convId, { before: first.created_at, beforeId: first.id });
      if (activeId.current !== convId) {
        return;
      }
      setMessages((prev) => mergeMessages(prev, page.messages ?? [], peerReadAt.current));
      setHasOlder(page.has_more);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load earlier messages');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function openPeer(peerId: string) {
    setBusy(true);
    try {
      const res = await api.openConversation(token, { peer_id: peerId });
      await loadThread(res.conversation);
      await loadConversations();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not open chat');
    } finally {
      setBusy(false);
    }
  }

  async function openLoan(loanId: string) {
    setBusy(true);
    try {
      const res = await api.openConversation(token, { loan_id: loanId });
      await loadThread(res.conversation);
      await loadConversations();
      onLoanOpened?.();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not open loan chat');
      onLoanOpened?.();
    } finally {
      setBusy(false);
    }
  }

  async function refreshMessages() {
    const convId = activeId.current;
    if (!convId || !cursor.current) {
      return; // the first page is still loading
    }
    try {
      const page = await api.listMessages(token, convId, { since: cursor.current });
      if (activeId.current !== convId) {
        return;
      }
      cursor.current = page.cursor;
      peerReadAt.current = page.peer_read_at ?? peerReadAt.current;
      setMessages((prev) => mergeMessages(prev, page.messages ?? [], peerReadAt.current));
    } catch (e) {
      // The thread was merged into another one (e.g. a loan chat): reopen it by person.
      const peer = active?.peer?.id;
      if (peer && e instanceof Error && /conversation not found/i.test(e.message)) {
        const res = await api.openConversation(token, { peer_id: peer });
        await loadThread(res.conversation);
      }
    }
  }

  useEffect(() => {
    loadConversations().catch((e) => onError(e instanceof Error ? e.message : 'Could not load chats'));
  }, [token]);

  useEffect(() => {
    if (openLoanId) {
      openLoan(openLoanId).catch(() => undefined);
    }
  }, [openLoanId, token]);

  useEffect(() => {
    if (openPeerId) {
      openPeer(openPeerId)
        .catch(() => undefined)
        .finally(() => onPeerOpened?.());
    }
  }, [openPeerId, token]);

  useEffect(() => {
    if (!active) {
      const listPoll = setInterval(() => {
        loadConversations().catch(() => undefined);
      }, 5000);
      return () => clearInterval(listPoll);
    }
    const t = setInterval(() => {
      refreshMessages().catch(() => undefined);
    }, 2500);
    // The chat list (unread badges) changes slowly; no need to reload it with every poll.
    const listPoll = setInterval(() => {
      loadConversations().catch(() => undefined);
    }, 15000);
    return () => {
      clearInterval(t);
      clearInterval(listPoll);
    };
  }, [active?.id, token]);

  useEffect(() => {
    onActiveChange?.(Boolean(active));
    return () => onActiveChange?.(false);
  }, [active]);

  /** Shows the message at once and sends it in the background; a failed one waits for a tap. */
  async function deliver(item: Outgoing) {
    setOutbox((list) => list.map((o) => (o.tmpId === item.tmpId ? { ...o, failed: false } : o)));
    try {
      const res = await api.sendMessage(token, item.convId, {
        body: item.body,
        reply_to_message_id: item.replyTo?.id,
      });
      if (activeId.current === item.convId) {
        setMessages((prev) => mergeMessages(prev, [res.message], peerReadAt.current));
      }
      setOutbox((list) => list.filter((o) => o.tmpId !== item.tmpId));
      loadConversations().catch(() => undefined);
    } catch {
      setOutbox((list) => list.map((o) => (o.tmpId === item.tmpId ? { ...o, failed: true } : o)));
    }
  }

  function sendText(extra?: string) {
    if (!active) {
      return;
    }
    const body = (extra ?? draft).trim();
    if (!body) {
      return;
    }
    const item: Outgoing = {
      tmpId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      convId: active.id,
      body,
      replyTo,
      createdAt: new Date().toISOString(),
      failed: false,
    };
    setDraft('');
    setReplyTo(null);
    setShowEmoji(false);
    setOutbox((list) => [...list, item]);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    void deliver(item);
  }

  async function sendFile() {
    if (!active) {
      return;
    }
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) {
      return;
    }
    const asset = picked.assets[0];
    setBusy(true);
    try {
      let b64: string;
      if (Platform.OS === 'web' && typeof fetch === 'function') {
        const blob = await fetch(asset.uri).then((r) => r.blob());
        b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            const idx = result.indexOf(',');
            resolve(idx >= 0 ? result.slice(idx + 1) : result);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } else {
        b64 = await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64 });
      }
      const kind = (asset.mimeType ?? '').startsWith('image/') ? 'image' : 'file';
      const res = await api.sendMessage(token, active.id, {
        reply_to_message_id: replyTo?.id,
        attachment_kind: kind,
        attachment_name: asset.name,
        attachment_mime: asset.mimeType ?? 'application/octet-stream',
        attachment_base64: b64,
      });
      setReplyTo(null);
      setMessages((prev) => mergeMessages(prev, [res.message], peerReadAt.current));
      loadConversations().catch(() => undefined);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not send file');
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecord() {
    if (!active) {
      return;
    }
    if (Platform.OS === 'web') {
      onError('Voice notes are available in the mobile app');
      return;
    }
    try {
      if (recorderState.isRecording || audioRecorder.isRecording) {
        await audioRecorder.stop();
        // URI is set after stop resolves; poll briefly if needed.
        let uri = audioRecorder.uri;
        for (let i = 0; !uri && i < 8; i++) {
          await new Promise((r) => setTimeout(r, 40));
          uri = audioRecorder.uri;
        }
        if (!uri) {
          onError('Recording produced no audio file');
          return;
        }
        setBusy(true);
        const b64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
        if (!b64) {
          setBusy(false);
          onError('Could not read voice recording');
          return;
        }
        const status = audioRecorder.getStatus();
        const fromRecorderMs = Math.max(0, Math.round(status.durationMillis || 0));
        const duration = Math.max(
          500,
          fromRecorderMs || Date.now() - (recordStartedAt.current || Date.now()),
        );
        const durationMs = Math.min(duration, 2_147_483_647);
        const res = await api.sendMessage(token, active.id, {
          reply_to_message_id: replyTo?.id,
          attachment_kind: 'voice',
          attachment_name: 'voice.m4a',
          attachment_mime: 'audio/mp4',
          attachment_base64: b64,
          voice_duration_ms: durationMs,
        });
        setReplyTo(null);
        setMessages((prev) => mergeMessages(prev, [res.message], peerReadAt.current));
        loadConversations().catch(() => undefined);
        setBusy(false);
        return;
      }
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onError('Microphone permission is required for voice notes');
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      await audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      audioRecorder.record();
      recordStartedAt.current = Date.now();
    } catch (e) {
      setBusy(false);
      onError(e instanceof Error ? e.message : 'Voice recording failed');
    }
  }

  async function cancelRecording() {
    try {
      if (recorderState.isRecording || audioRecorder.isRecording) await audioRecorder.stop();
    } catch {
      /* nothing to stop */
    }
  }

  function playVoice(msg: ChatMessage) {
    if (!msg.attachment_url) {
      return;
    }
    // Tapping the playing note pauses it; another note stops the first.
    if (playingId === msg.id) {
      playerRef.current?.pause();
      setPlayingId(null);
      return;
    }
    try {
      playerRef.current?.remove();
      const url = msg.attachment_url.startsWith('http')
        ? msg.attachment_url
        : `${apiBaseUrl.replace(/\/api\/v1$/, '')}${msg.attachment_url}`;
      const player = createAudioPlayer({
        uri: url,
        headers: { Authorization: `Bearer ${token}` },
      });
      playerRef.current = player;
      player.addListener('playbackStatusUpdate', (status: { didJustFinish?: boolean }) => {
        if (status.didJustFinish) setPlayingId((id) => (id === msg.id ? null : id));
      });
      player.play();
      setPlayingId(msg.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not play voice note');
    }
  }

  async function react(msg: ChatMessage, emoji: string) {
    setReactFor(null);
    try {
      const remove = msg.reactions.some((r) => r.emoji === emoji && r.mine);
      const res = await api.reactMessage(token, msg.id, emoji, remove);
      setMessages((prev) => mergeMessages(prev, [res.message], peerReadAt.current));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not react');
    }
  }

  /** WhatsApp-style delete: your own messages can go for everyone, any message for you. */
  function askDeleteMessage(msg: ChatMessage) {
    setReactFor(null);
    const run = async (scope: 'me' | 'everyone') => {
      const before = messages;
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      try {
        await api.deleteMessage(token, msg.id, scope);
        loadConversations().catch(() => undefined);
      } catch (e) {
        setMessages(before);
        onError(e instanceof Error ? e.message : 'Could not delete message');
      }
    };
    const self = active ? isSelfConversation(active) : false;
    setSheet({
      title: 'Delete message?',
      actions: [
        ...(msg.mine && !self ? [{ label: 'Delete for everyone', tone: 'danger' as const, onPress: () => void run('everyone') }] : []),
        { label: self ? 'Delete' : 'Delete for me', tone: 'danger' as const, onPress: () => void run('me') },
      ],
    });
  }

  function askDeleteChat(c: Conversation) {
    const self = isSelfConversation(c);
    const name = self ? t(locale, 'chats.self') : c.peer.display_name;
    setSheet({
      title: self ? 'Clear saved messages?' : `Delete chat with ${name}?`,
      message: self ? undefined : `${name} keeps their copy.`,
      actions: [
        {
          label: self ? 'Clear' : 'Delete chat',
          tone: 'danger',
          onPress: async () => {
            const before = conversations;
            setConversations((list) => list.filter((x) => x.id !== c.id));
            threadCache.delete(c.id);
            try {
              await api.deleteConversation(token, c.id);
              loadConversations().catch(() => undefined);
            } catch (e) {
              setConversations(before);
              onError(e instanceof Error ? e.message : 'Could not delete chat');
            }
          },
        },
      ],
    });
  }

  function chatMenu(c: Conversation) {
    const self = isSelfConversation(c);
    setSheet({
      title: self ? t(locale, 'chats.self') : c.peer.display_name,
      actions: [
        ...(self || !onOpenProfile ? [] : [{ label: 'View profile', onPress: () => onOpenProfile(c.peer) }]),
        { label: self ? 'Clear saved messages' : 'Delete chat', tone: 'danger' as const, onPress: () => setTimeout(() => askDeleteChat(c), 250) },
      ],
    });
  }

  async function openSelfChat() {
    await openPeer(userId);
  }

  if (!active) {
    const peerIds = new Set(conversations.map((c) => c.peer.id));
    const startRows = friends.filter((f) => !peerIds.has(f.peer.id));
    const selfConv = conversations.find((c) => isSelfConversation(c));
    const threadRows = (() => {
      const rows = conversations.filter((c) => !isSelfConversation(c));
      const byPeer = new Map<string, Conversation>();
      for (const c of rows) {
        const existing = byPeer.get(c.peer.id);
        if (!existing || (!c.loan_id && existing.loan_id)) {
          byPeer.set(c.peer.id, c);
        }
      }
      return Array.from(byPeer.values());
    })();

    return (
      <View style={styles.shell}>
        <Text
          style={{
            color: colors.text,
            fontFamily: fonts.uiSemi,
            fontSize: 22,
            paddingHorizontal: 16,
            paddingTop: 4,
            paddingBottom: 10,
          }}
        >
          {t(locale, 'chats.title')}
        </Text>

        <Pressable
          style={styles.row}
          onPress={() => openSelfChat()}
          onLongPress={() => (selfConv ? chatMenu(selfConv) : undefined)}
          accessibilityRole="button"
          accessibilityLabel={t(locale, 'chats.self')}
        >
          <Pressable
            onPress={() => onOpenProfile?.({ id: userId, display_name: 'Self', avatar_url: selfAvatarUrl })}
            hitSlop={4}
          >
            <AuthenticatedAvatar
              path={selfAvatarUrl}
              localUri={selfAvatarLocalUri}
              token={token}
              size={46}
              fallbackLetter={selfInitial}
              style={{ backgroundColor: colors.primarySoft }}
            />
          </Pressable>
          <View style={styles.flex}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle}>{t(locale, 'chats.self')}</Text>
              {selfConv?.last_message_at ? <Text style={styles.rowTime}>{formatChatListTime(selfConv.last_message_at)}</Text> : null}
            </View>
            <Text style={styles.muted} numberOfLines={1}>
              {selfConv?.last_message_preview || t(locale, 'chats.selfHint')}
            </Text>
          </View>
        </Pressable>
        {startRows.map((f) => (
          <Pressable
            key={f.peer.id}
            style={styles.row}
            onPress={() => openPeer(f.peer.id)}
            onLongPress={() => onOpenProfile?.(f.peer)}
            accessibilityRole="button"
            accessibilityLabel={`Chat with ${f.peer.display_name}`}
          >
            <Pressable onPress={() => onOpenProfile?.(f.peer)} hitSlop={4}>
              <AuthenticatedAvatar
                path={f.peer.avatar_url}
                token={token}
                size={46}
                fallbackLetter={f.peer.display_name}
              />
            </Pressable>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{f.peer.display_name}</Text>
              <Text style={styles.muted}>{t(locale, 'chats.startChat')}</Text>
            </View>
          </Pressable>
        ))}
        {threadRows.map((c) => {
          const name =
            c.peer.id === userId || c.peer.display_name === 'Self' || c.peer.display_name === 'Saved Messages'
              ? t(locale, 'chats.self')
              : c.peer.display_name;
          const moneyItems = conversationMoneyItems(c);
          return (
            <Pressable
              key={c.id}
              style={styles.row}
              onPress={() => {
                loadThread(c).catch((e) => onError(e instanceof Error ? e.message : 'Could not open chat'));
              }}
              onLongPress={() => chatMenu(c)}
              delayLongPress={300}
            >
              <Pressable onPress={() => onOpenProfile?.(c.peer)} hitSlop={4}>
                <AuthenticatedAvatar
                  path={c.peer.avatar_url}
                  token={token}
                  size={46}
                  fallbackLetter={c.peer.display_name}
                />
              </Pressable>
              <View style={styles.flex}>
                <View style={styles.rowTop}>
                  <View style={styles.nameRow}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {name}
                    </Text>
                    {moneyItems.map((m) => {
                      const lent = m.role === 'lent';
                      const label = formatMoneyLabel(m.amount, m.currency);
                      if (!label) {
                        return null;
                      }
                      return (
                        <View
                          key={m.loan_id}
                          style={[
                            styles.moneyChip,
                            {
                              backgroundColor: lent ? colors.successSoft : colors.warningSoft,
                              borderColor: lent ? colors.success : colors.warning,
                            },
                          ]}
                        >
                          <Text style={[styles.moneyChipText, { color: lent ? colors.success : colors.warning }]}>
                            {label}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.metaCol}>
                    <Text style={styles.rowTime}>{formatChatListTime(c.last_message_at)}</Text>
                    {c.last_message_mine && c.last_message_preview ? (
                      <Text
                        style={[styles.ticks, { color: c.last_message_read ? colors.primary : colors.muted }]}
                        accessibilityLabel={c.last_message_read ? 'Read' : 'Sent'}
                      >
                        {c.last_message_read ? '✓✓' : '✓'}
                      </Text>
                    ) : c.unread_count > 0 ? (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>{c.unread_count > 99 ? '99+' : c.unread_count}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Text style={styles.muted} numberOfLines={1}>
                  {c.last_message_preview || ' '}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {sheetEl}
      </View>
    );
  }

  // A pending message whose real copy already arrived (via the poll) is not shown twice.
  const pendingHere = outbox.filter(
    (o) =>
      o.convId === active.id &&
      (o.failed || !messages.some((m) => m.mine && m.body === o.body && Date.parse(m.created_at) >= Date.parse(o.createdAt) - 5000)),
  );
  const listData: ChatMessage[] = [
    ...messages,
    ...pendingHere.map(
      (o): ChatMessage => ({
        id: o.tmpId,
        conversation_id: o.convId,
        sender_id: userId,
        mine: true,
        body: o.body,
        reply_to: o.replyTo,
        attachment_kind: '',
        reactions: [],
        created_at: o.createdAt,
      }),
    ),
  ];
  const isSelfChat = active.peer.id === userId || active.peer.display_name === 'Self' || active.peer.display_name === 'Saved Messages';
  const peerTitle = isSelfChat ? 'Self' : active.peer.display_name;
  const peerInitial = isSelfChat ? selfInitial : active.peer.display_name.slice(0, 1).toUpperCase();

  return (
    <KeyboardAvoidingView
      style={[styles.shell, styles.threadShell]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <View style={styles.threadHeader}>
        <Pressable
          onPress={() => {
            closeThread();
            setReplyTo(null);
            loadConversations();
          }}
          style={styles.headerBubble}
          accessibilityRole="button"
          accessibilityLabel="Back to chats"
        >
          <IconBack size={18} color={colors.text} />
        </Pressable>

        <Pressable
          onPress={() => onOpenProfile?.(active.peer)}
          style={styles.peerBubble}
          accessibilityRole="button"
          accessibilityLabel={peerTitle}
        >
          <AuthenticatedAvatar
            path={isSelfChat ? selfAvatarUrl : active.peer.avatar_url}
            localUri={isSelfChat ? selfAvatarLocalUri : undefined}
            token={token}
            size={28}
            fallbackLetter={peerInitial}
            style={isSelfChat ? { backgroundColor: colors.primarySoft } : undefined}
          />
          <Text style={styles.peerBubbleName} numberOfLines={1}>
            {peerTitle}
          </Text>
        </Pressable>

        {!isSelfChat && onCreateLoanWith ? (
          <Pressable
            onPress={() => onCreateLoanWith(active.peer)}
            style={styles.headerBubble}
            accessibilityRole="button"
            accessibilityLabel="Create loan"
          >
            <IconLoans size={18} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.headerBubbleSpacer} />
        )}
      </View>

      {conversationMoneyItems(active).length ? (
        <View style={styles.moneyPinRow}>
          {conversationMoneyItems(active).map((m) => {
            const lent = m.role === 'lent';
            const tone = lent ? colors.success : colors.warning;
            return (
              <Pressable
                key={m.loan_id}
                style={[styles.moneyOutlineBubble, { borderColor: tone }]}
                onPress={() => {
                  if (onOpenLoan) {
                    onOpenLoan(m.loan_id);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={lent ? 'Money you lent' : 'Money you borrowed'}
              >
                <Text style={[styles.moneyBlockAmount, { color: tone }]} numberOfLines={1}>
                  {formatMoneyLabel(m.amount, m.currency) || 'Loan'}
                </Text>
                <Text style={[styles.moneyBlockDays, { color: tone }]} numberOfLines={1}>
                  {formatDaysLeft(m.due_at)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={listData}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // Keep the view still when earlier messages are added above it.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        ListHeaderComponent={
          hasOlder ? (
            <Pressable onPress={() => void loadOlder()} disabled={loadingOlder} style={{ alignSelf: 'center', padding: 10 }}>
              <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                {loadingOlder ? 'Loading…' : 'Load earlier messages'}
              </Text>
            </Pressable>
          ) : null
        }
        onContentSizeChange={() => {
          // Follow the conversation only when a newer message arrives, not when older ones load.
          const newest = listData[listData.length - 1]?.id;
          if (newest && newest !== scrolledToNewest.current) {
            scrolledToNewest.current = newest;
            listRef.current?.scrollToEnd({ animated: true });
          }
        }}
        renderItem={({ item, index }) => {
          const prev = listData[index - 1];
          const showDay = !prev || !sameDay(prev.created_at, item.created_at);
          // Messages from the same person a minute apart sit closer together.
          const grouped = !showDay && prev && prev.mine === item.mine && Math.abs(Date.parse(item.created_at) - Date.parse(prev.created_at)) < 60_000;
          const pending = pendingHere.find((o) => o.tmpId === item.id);
          return (
            <View style={{ marginTop: grouped ? 0 : 6 }}>
              {showDay ? (
                <View style={styles.dayChip}>
                  <Text style={styles.dayChipText}>{dayLabel(item.created_at, locale)}</Text>
                </View>
              ) : null}
              <Pressable
                onLongPress={() => (pending ? undefined : setReactFor(item.id))}
                onPress={() => {
                  if (pending?.failed) void deliver(pending);
                  else if (reactFor) setReactFor(null);
                }}
                delayLongPress={250}
                style={[styles.bubbleWrap, item.mine ? styles.mineWrap : styles.theirsWrap, pending && !pending.failed ? { opacity: 0.75 } : null]}
              >
                {item.reply_to ? (
                  <View style={styles.replyBox}>
                    <Text style={styles.replyText} numberOfLines={2}>
                      {item.reply_to.body || attachmentLabel(item.reply_to)}
                    </Text>
                  </View>
                ) : null}
                {item.attachment_kind === 'image' && item.attachment_url ? (
                  <Pressable onPress={() => setViewImage(item.attachment_url!)} onLongPress={() => setReactFor(item.id)}>
                    <AuthenticatedImage path={item.attachment_url} token={token} width={220} height={220} />
                  </Pressable>
                ) : null}
                {item.attachment_kind === 'voice' ? (
                  <Pressable onPress={() => playVoice(item)} hitSlop={6} style={styles.voiceRow} accessibilityRole="button" accessibilityLabel={playingId === item.id ? 'Pause voice note' : 'Play voice note'}>
                    <View style={[styles.voiceBtn, item.mine && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                      <Text style={[styles.voiceBtnText, item.mine && styles.mineText]}>{playingId === item.id ? '❚❚' : '▶'}</Text>
                    </View>
                    <View style={styles.voiceWave}>
                      {[6, 12, 9, 16, 8, 14, 10, 18, 7, 13, 9, 15, 6, 11].map((h, i) => (
                        <View key={i} style={[styles.voiceBar, { height: h }, item.mine && { backgroundColor: 'rgba(255,255,255,0.7)' }]} />
                      ))}
                    </View>
                    <Text style={[styles.timeCorner, item.mine && styles.mineTime]}>{mmss(item.voice_duration_ms ?? 0)}</Text>
                  </Pressable>
                ) : null}
                <View style={styles.bubbleBody}>
                  {item.body || item.attachment_kind === 'file' ? (
                    <Text style={[styles.bubbleText, item.mine && styles.mineText]}>
                      {item.body ? item.body : `📎 ${item.attachment_name || 'Attachment'}`}
                    </Text>
                  ) : null}
                  <View style={styles.timeCornerRow}>
                    <Text style={[styles.timeCorner, item.mine && styles.mineTime]}>
                      {pending?.failed
                        ? 'Not sent · tap to retry'
                        : new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {item.mine && pending && !pending.failed ? (
                      <Text style={[styles.timeCorner, styles.mineTime]}>🕓</Text>
                    ) : item.mine && !pending && !isSelfChat ? (
                      <Text
                        style={[styles.ticks, styles.bubbleTicks, { opacity: item.read ? 1 : 0.6 }]}
                        accessibilityLabel={item.read ? 'Read' : 'Sent'}
                      >
                        {item.read ? '✓✓' : '✓'}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {item.reactions?.length ? (
                  <View style={styles.reactionRow}>
                    {item.reactions.map((r) => (
                      <Pressable key={r.emoji} style={[styles.reactionChip, r.mine && styles.reactionMine]} onPress={() => react(item, r.emoji)}>
                        <Text style={styles.reactionText}>
                          {r.emoji} {r.count}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </Pressable>
              {reactFor === item.id ? (
                <View style={[styles.actionSheet, item.mine ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
                  <View style={styles.reactionPicker}>
                    {REACTION_EMOJIS.map((e) => (
                      <Pressable key={e} onPress={() => react(item, e)} style={styles.reactionPick}>
                        <Text style={styles.emoji}>{e}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => {
                        setReplyTo(item);
                        setReactFor(null);
                      }}
                      style={styles.actionBtn}
                    >
                      <Text style={styles.actionText}>↩ Reply</Text>
                    </Pressable>
                    {item.body ? (
                      <Pressable
                        onPress={() => {
                          void Clipboard.setStringAsync(item.body || '');
                          setReactFor(null);
                        }}
                        style={styles.actionBtn}
                      >
                        <Text style={styles.actionText}>⧉ Copy</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => askDeleteMessage(item)} style={styles.actionBtn}>
                      <Text style={[styles.actionText, { color: colors.error }]}>🗑 Delete</Text>
                    </Pressable>
                    <Pressable onPress={() => setReactFor(null)} style={styles.actionBtn}>
                      <Text style={[styles.actionText, { color: colors.muted }]}>Close</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        }}
      />

      {replyTo ? (
        <View style={styles.replyBar}>
          <View style={styles.flex}>
            <Text style={styles.replyLabel}>Replying</Text>
            <Text style={styles.muted} numberOfLines={1}>
              {replyTo.body || attachmentLabel(replyTo)}
            </Text>
          </View>
          <Pressable onPress={() => setReplyTo(null)}>
            <Text style={styles.headerLink}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {showEmoji ? (
        <View style={styles.emojiBar}>
          {COMPOSER_EMOJIS.map((e) => (
            <Pressable key={e} onPress={() => setDraft((d) => d + e)} style={styles.reactionPick}>
              <Text style={styles.emoji}>{e}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {recorderState.isRecording ? (
        <View style={styles.recordBar}>
          <View style={styles.recordDot} />
          <Text style={styles.recordText}>Recording {mmss(recordMs)}</Text>
          <Pressable onPress={() => void cancelRecording()} hitSlop={8}>
            <Text style={[styles.headerLink, { color: colors.muted }]}>Cancel</Text>
          </Pressable>
          <Pressable onPress={toggleRecord} hitSlop={8}>
            <Text style={styles.headerLink}>Send</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={Boolean(viewImage)} transparent animationType="fade" onRequestClose={() => setViewImage(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewImage(null)}>
          {viewImage ? <AuthenticatedImage path={viewImage} token={token} width={360} height={480} radius={0} /> : null}
          <Text style={styles.viewerHint}>Tap to close</Text>
        </Pressable>
      </Modal>

      <View style={styles.composer}>
        <View style={styles.inputBubble}>
          <Pressable onPress={() => setShowEmoji((v) => !v)} accessibilityLabel="Emoji" style={styles.iconBtn}>
            <IconEmoji size={20} color={showEmoji ? colors.primary : colors.muted} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={t(locale, 'chats.messagePlaceholder')}
            placeholderTextColor={colors.muted}
            multiline
            onFocus={() => {
              setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 120);
            }}
          />
        </View>
        <Pressable onPress={sendFile} accessibilityLabel="Attach file" style={styles.sideIconBtn}>
          <IconAttach size={20} color={colors.muted} />
        </Pressable>
        {draft.trim() ? (
          <Pressable style={styles.sendIconBtn} onPress={() => sendText()} accessibilityLabel="Send">
            <IconSend size={18} color={colors.onPrimary} />
          </Pressable>
        ) : (
          <Pressable
            onPress={toggleRecord}
            accessibilityLabel={recorderState.isRecording ? 'Stop recording' : 'Record voice'}
            style={styles.sideIconBtn}
          >
            <IconMic size={20} color={recorderState.isRecording ? colors.error : colors.muted} />
          </Pressable>
        )}
      </View>
      {sheetEl}
    </KeyboardAvoidingView>
  );
}

function attachmentLabel(msg: ChatMessage): string {
  if (msg.attachment_kind === 'voice') {
    return 'Voice message';
  }
  if (msg.attachment_kind === 'image') {
    return 'Photo';
  }
  if (msg.attachment_kind === 'file') {
    return msg.attachment_name || 'File';
  }
  return 'Message';
}

function conversationMoneyItems(c: Conversation): ConversationMoney[] {
  if (c.money?.length) {
    return c.money;
  }
  if (c.money_role && (c.active_loan_id || c.loan_id)) {
    return [
      {
        loan_id: c.active_loan_id || c.loan_id || '',
        role: c.money_role,
        amount: c.money_amount,
        currency: c.money_currency,
        due_at: c.money_due_at,
        ref: c.money_ref || undefined,
      },
    ];
  }
  return [];
}

function formatMoneyLabel(amount?: string | null, currency?: string | null): string {
  return formatMoney(amount, currency);
}

function formatDaysLeft(iso?: string | null): string {
  if (!iso) {
    return 'No due date';
  }
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) {
    return 'No due date';
  }
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.round((startDue.getTime() - startToday.getTime()) / 86400000);
  if (days > 1) {
    return `${days} days left`;
  }
  if (days === 1) {
    return '1 day left';
  }
  if (days === 0) {
    return 'Due today';
  }
  if (days === -1) {
    return '1 day overdue';
  }
  return `${Math.abs(days)} days overdue`;
}

function formatChatListTime(iso?: string | null): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startToday.getTime() - startMsg.getTime()) / 86400000);
  if (dayDiff <= 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (dayDiff < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    shell: {
      flex: 1,
      backgroundColor: colors.background,
      overflow: 'hidden',
      paddingBottom: 72,
    },
    threadShell: {
      paddingBottom: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    threadHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 4,
      paddingTop: 4,
      paddingBottom: 10,
    },
    headerBubble: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    headerBubbleSpacer: { width: 42, height: 42 },
    peerBubble: {
      flex: 1,
      minHeight: 42,
      borderRadius: 21,
      paddingHorizontal: 10,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    headerAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerAvatarText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    peerBubbleName: { color: colors.text, fontSize: 15, fontFamily: fonts.uiSemi, maxWidth: '70%' },
    headerTitle: { color: colors.text, fontSize: 17, fontFamily: fonts.uiBold },
    headerLink: { color: colors.tertiary, fontFamily: fonts.uiSemi, fontSize: 15 },
    sectionTitle: { color: colors.text, fontSize: 15, fontFamily: fonts.uiSemi, marginBottom: 4 },
    hint: { color: colors.muted, padding: 16, fontSize: 13, lineHeight: 18, fontFamily: fonts.ui },
    row: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.primary, fontFamily: fonts.uiBold, fontSize: 18 },
    flex: { flex: 1 },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    nameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    rowTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.uiSemi, flexShrink: 1 },
    metaCol: { alignItems: 'flex-end', gap: 4, minWidth: 44 },
    metaColEnd: { alignItems: 'flex-end', marginTop: 4, gap: 1 },
    rowTime: { color: colors.muted, fontSize: 12, fontFamily: fonts.ui },
    ticksInline: { color: colors.muted, fontSize: 10, fontFamily: fonts.ui, lineHeight: 12 },
    ticksRead: { opacity: 1 },
    unreadBadge: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.tertiary,
    },
    unreadBadgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: fonts.uiBold },
    moneyChip: {
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    moneyChipText: { fontSize: 11, fontFamily: fonts.uiBold },
    muted: { color: colors.muted, fontSize: 13, fontFamily: fonts.ui },
    moneyPinRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 12,
      marginBottom: 8,
    },
    moneyOutlineBubble: {
      flexGrow: 1,
      flexBasis: '46%',
      borderRadius: 12,
      borderWidth: 1,
      backgroundColor: 'transparent',
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    moneyBlockAmount: { fontSize: 14, fontFamily: fonts.uiBold, flexShrink: 1 },
    moneyBlockDays: { fontSize: 12, fontFamily: fonts.uiSemi },
    thread: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 20, gap: 2 },
    bubbleWrap: {
      maxWidth: '78%',
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 6,
      marginVertical: 2,
    },
    mineWrap: {
      alignSelf: 'flex-end',
      backgroundColor: colors.primary,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 4,
    },
    theirsWrap: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderBottomLeftRadius: 4,
      borderBottomRightRadius: 16,
    },
    bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21, fontFamily: fonts.ui },
    mineText: { color: colors.onPrimary },
    bubbleBody: {},
    dayChip: {
      alignSelf: 'center',
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: colors.surfaceMuted,
      marginVertical: 10,
    },
    dayChipText: { color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12 },
    voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, minWidth: 200 },
    voiceBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    voiceBtnText: { color: colors.primary, fontFamily: fonts.uiBold, fontSize: 13 },
    voiceWave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
    voiceBar: { width: 3, borderRadius: 2, backgroundColor: colors.muted },
    actionSheet: { gap: 6, marginTop: 4, marginBottom: 6, maxWidth: '92%' },
    actionRow: { flexDirection: 'row', gap: 6 },
    actionBtn: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    actionText: { color: colors.text, fontFamily: fonts.uiSemi, fontSize: 13 },
    recordBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginHorizontal: 12,
      marginBottom: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error },
    recordText: { flex: 1, color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 },
    viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', gap: 16 },
    viewerHint: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.ui, fontSize: 13 },
    timeCornerRow: {
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 2,
    },
    timeCorner: {
      color: colors.muted,
      fontSize: 9,
      lineHeight: 12,
      fontFamily: fonts.ui,
    },
    ticks: { fontSize: 12, lineHeight: 14, fontFamily: fonts.uiBold, letterSpacing: -3, marginLeft: 3, paddingRight: 3 },
    bubbleTicks: { color: '#FFFFFF' },
    tickStack: {
      width: 16,
      height: 14,
      position: 'relative',
      marginLeft: 1,
    },
    tickMark: { fontSize: 12, lineHeight: 14, fontFamily: fonts.uiBold, position: 'absolute', top: 0 },
    tickBack: { left: 0 },
    tickFront: { left: 5 },
    timeInline: { color: colors.muted, fontSize: 9, fontFamily: fonts.ui },
    playHint: { color: colors.muted, fontSize: 11, fontFamily: fonts.ui, marginTop: 2 },
    time: { color: colors.muted, fontSize: 9, alignSelf: 'flex-end', fontFamily: fonts.ui },
    mineTime: { color: colors.onPrimary, opacity: 0.72 },
    replyBox: {
      borderLeftWidth: 2,
      borderLeftColor: colors.tertiary,
      paddingLeft: 8,
      marginBottom: 4,
      opacity: 0.9,
    },
    replyText: { color: colors.textSecondary, fontSize: 12, fontFamily: fonts.ui },
    reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
    reactionChip: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 12,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    reactionMine: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    reactionText: { color: colors.text, fontSize: 12, fontFamily: fonts.ui },
    reactionPicker: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      marginTop: 8,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    emojiBar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      padding: 12,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    reactionPick: {
      paddingHorizontal: 6,
      paddingVertical: 4,
      borderRadius: 8,
    },
    emoji: { fontSize: 22 },
    reactionPickText: { fontFamily: fonts.uiSemi, color: colors.text, fontSize: 13 },
    replyBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    replyLabel: { color: colors.tertiary, fontSize: 12, fontFamily: fonts.uiBold },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 4,
      paddingVertical: 8,
    },
    inputBubble: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 4,
      minHeight: 44,
      backgroundColor: colors.surface,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingLeft: 6,
      paddingRight: 12,
      paddingVertical: 4,
    },
    iconBtn: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 2,
    },
    sideIconBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    sendIconBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    toolBtn: {
      minHeight: 40,
      paddingHorizontal: 6,
      justifyContent: 'center',
      paddingBottom: 8,
    },
    tool: { color: colors.muted, fontSize: 13, fontFamily: fonts.uiSemi },
    input: {
      flex: 1,
      minHeight: 36,
      maxHeight: 120,
      paddingVertical: 8,
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.ui,
    },
    send: {
      backgroundColor: colors.primary,
      borderRadius: 20,
      minHeight: 40,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendText: { color: colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 14 },
  });
}
