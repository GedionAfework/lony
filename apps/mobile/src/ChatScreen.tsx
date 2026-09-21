import {
  AudioModule,
  createAudioPlayer,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  api,
  type ChatMessage,
  type Conversation,
} from './api';
import { apiBaseUrl, fonts, useTheme, type ThemeColors } from './theme';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];
const COMPOSER_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅',
  '😭', '😡', '👍', '👎', '❤️', '🔥', '🙏', '👏', '🎉', '✅',
  '💯', '🤝', '💪', '✨', '📌', '💰', '🏦', '📱',
];

type Props = {
  token: string;
  friends: { peer: { id: string; display_name: string } }[];
  openLoanId?: string | null;
  onLoanOpened?: () => void;
  onBack: () => void;
  onError: (message: string) => void;
  notifications?: {
    id: string;
    title: string;
    body: string;
    loan_id?: string | null;
    read_at?: string | null;
    created_at: string;
  }[];
  unreadCount?: number;
  onMarkAllRead?: () => void;
  onMarkRead?: (id: string) => void;
  onOpenLoan?: (loanId: string) => void;
  locale?: string;
};

export function ChatScreen({
  token,
  friends,
  openLoanId,
  onLoanOpened,
  onBack,
  onError,
  notifications = [],
  unreadCount = 0,
  onMarkAllRead,
  onMarkRead,
  onOpenLoan,
  locale = 'en',
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const lastCreated = useRef<string | undefined>(undefined);
  const recordStartedAt = useRef<number>(0);

  async function loadConversations() {
    const res = await api.listConversations(token);
    setConversations(res.conversations ?? []);
  }

  async function openPeer(peerId: string) {
    setBusy(true);
    try {
      const res = await api.openConversation(token, { peer_id: peerId });
      setActive(res.conversation);
      lastCreated.current = undefined;
      const msgs = await api.listMessages(token, res.conversation.id);
      setMessages(msgs.messages ?? []);
      if (msgs.messages?.length) {
        lastCreated.current = msgs.messages[msgs.messages.length - 1].created_at;
      }
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
      setActive(res.conversation);
      lastCreated.current = undefined;
      const msgs = await api.listMessages(token, res.conversation.id);
      setMessages(msgs.messages ?? []);
      if (msgs.messages?.length) {
        lastCreated.current = msgs.messages[msgs.messages.length - 1].created_at;
      }
      await loadConversations();
      onLoanOpened?.();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not open loan chat');
      onLoanOpened?.();
    } finally {
      setBusy(false);
    }
  }

  async function refreshMessages(full = false) {
    if (!active) {
      return;
    }
    const res = await api.listMessages(token, active.id, full ? undefined : lastCreated.current);
    const incoming = res.messages ?? [];
    if (!incoming.length) {
      return;
    }
    setMessages((prev) => {
      if (full || !lastCreated.current) {
        return incoming;
      }
      const seen = new Set(prev.map((m) => m.id));
      const merged = [...prev];
      for (const m of incoming) {
        if (!seen.has(m.id)) {
          merged.push(m);
        } else {
          const idx = merged.findIndex((x) => x.id === m.id);
          if (idx >= 0) {
            merged[idx] = m;
          }
        }
      }
      return merged;
    });
    lastCreated.current = incoming[incoming.length - 1]?.created_at ?? lastCreated.current;
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
    if (!active) {
      return;
    }
    const t = setInterval(() => {
      refreshMessages(false).catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [active?.id, token]);

  async function sendText(extra?: string) {
    if (!active) {
      return;
    }
    const body = (extra ?? draft).trim();
    if (!body) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.sendMessage(token, active.id, {
        body,
        reply_to_message_id: replyTo?.id,
      });
      setDraft('');
      setReplyTo(null);
      setShowEmoji(false);
      setMessages((prev) => [...prev, res.message]);
      lastCreated.current = res.message.created_at;
      await loadConversations();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(false);
    }
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
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: 'base64',
      });
      const kind = (asset.mimeType ?? '').startsWith('image/') ? 'image' : 'file';
      const res = await api.sendMessage(token, active.id, {
        reply_to_message_id: replyTo?.id,
        attachment_kind: kind,
        attachment_name: asset.name,
        attachment_mime: asset.mimeType ?? 'application/octet-stream',
        attachment_base64: b64,
      });
      setReplyTo(null);
      setMessages((prev) => [...prev, res.message]);
      lastCreated.current = res.message.created_at;
      await loadConversations();
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
    try {
      if (recorderState.isRecording) {
        await audioRecorder.stop();
        const uri = audioRecorder.uri;
        if (!uri) {
          return;
        }
        setBusy(true);
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: 'base64',
        });
        const duration = Math.max(500, Date.now() - (recordStartedAt.current || Date.now()));
        const res = await api.sendMessage(token, active.id, {
          reply_to_message_id: replyTo?.id,
          attachment_kind: 'voice',
          attachment_name: 'voice.m4a',
          attachment_mime: 'audio/m4a',
          attachment_base64: b64,
          voice_duration_ms: duration,
        });
        setReplyTo(null);
        setMessages((prev) => [...prev, res.message]);
        lastCreated.current = res.message.created_at;
        await loadConversations();
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
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      recordStartedAt.current = Date.now();
    } catch (e) {
      setBusy(false);
      onError(e instanceof Error ? e.message : 'Voice recording failed');
    }
  }

  async function playVoice(msg: ChatMessage) {
    if (!msg.attachment_url) {
      return;
    }
    try {
      const url = msg.attachment_url.startsWith('http')
        ? msg.attachment_url
        : `${apiBaseUrl.replace(/\/api\/v1$/, '')}${msg.attachment_url}`;
      const player = createAudioPlayer({
        uri: url,
        headers: { Authorization: `Bearer ${token}` },
      });
      player.play();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not play voice note');
    }
  }

  async function react(msg: ChatMessage, emoji: string) {
    setBusy(true);
    try {
      const remove = msg.reactions.some((r) => r.emoji === emoji && r.mine);
      const res = await api.reactMessage(token, msg.id, emoji, remove);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? res.message : m)));
      setReactFor(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not react');
    } finally {
      setBusy(false);
    }
  }

  if (!active) {
    return (
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={{ width: 48 }} />
          <Text style={styles.headerTitle}>Chats</Text>
          <View style={{ width: 48 }} />
        </View>

        <View style={{ paddingHorizontal: 14, gap: 8, marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.sectionTitle}>Inbox{unreadCount > 0 ? ` · ${unreadCount}` : ''}</Text>
            {unreadCount > 0 && onMarkAllRead ? (
              <Pressable onPress={onMarkAllRead}>
                <Text style={styles.headerLink}>Mark all read</Text>
              </Pressable>
            ) : null}
          </View>
          {notifications.length === 0 ? (
            <Text style={styles.muted}>No notifications</Text>
          ) : (
            notifications.slice(0, 8).map((n) => (
              <Pressable
                key={n.id}
                style={styles.row}
                onPress={() => {
                  if (!n.read_at) onMarkRead?.(n.id);
                  if (n.loan_id) onOpenLoan?.(n.loan_id);
                }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: n.read_at ? 'transparent' : colors.primary,
                    marginTop: 6,
                  }}
                />
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>{n.title}</Text>
                  <Text style={styles.muted} numberOfLines={2}>
                    {n.body}
                  </Text>
                  <Text style={styles.muted}>{new Date(n.created_at).toLocaleString(locale)}</Text>
                </View>
              </Pressable>
            ))
          )}
        </View>

        <Text style={[styles.sectionTitle, { paddingHorizontal: 14 }]}>Messages</Text>
        {friends.map((f) => (
          <Pressable
            key={f.peer.id}
            style={styles.row}
            onPress={() => openPeer(f.peer.id)}
            accessibilityRole="button"
            accessibilityLabel={`Chat with ${f.peer.display_name}`}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{f.peer.display_name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{f.peer.display_name}</Text>
              <Text style={styles.muted}>Start or continue chat</Text>
            </View>
          </Pressable>
        ))}
        {conversations.map((c) => (
          <Pressable
            key={c.id}
            style={styles.row}
            onPress={() => {
              setActive(c);
              lastCreated.current = undefined;
              api.listMessages(token, c.id).then((res) => {
                setMessages(res.messages ?? []);
                if (res.messages?.length) {
                  lastCreated.current = res.messages[res.messages.length - 1].created_at;
                }
              });
            }}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{c.peer.display_name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>
                {c.peer.display_name}
                {c.loan_id ? ' · loan' : ''}
                {c.unread_count > 0 ? ` · ${c.unread_count}` : ''}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {c.last_message_preview || 'No messages yet'}
              </Text>
            </View>
          </Pressable>
        ))}
        {friends.length === 0 && conversations.length === 0 ? (
          <Text style={[styles.muted, { paddingHorizontal: 14 }]}>Add a friend first, then open a chat.</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            setActive(null);
            setMessages([]);
            setReplyTo(null);
            loadConversations();
          }}
        >
          <Text style={styles.headerLink}>Chats</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{active.peer.display_name}{active.loan_id ? ' · loan' : ''}</Text>
        <View style={{ width: 48 }} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.thread}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <Pressable
            onLongPress={() => {
              setReactFor(item.id);
              setReplyTo(item);
            }}
            style={[styles.bubbleWrap, item.mine ? styles.mineWrap : styles.theirsWrap]}
          >
            {item.reply_to ? (
              <View style={styles.replyBox}>
                <Text style={styles.replyText} numberOfLines={2}>
                  {item.reply_to.body || attachmentLabel(item.reply_to)}
                </Text>
              </View>
            ) : null}
            {item.body ? <Text style={[styles.bubbleText, item.mine && styles.mineText]}>{item.body}</Text> : null}
            {item.attachment_kind === 'voice' ? (
              <Pressable onPress={() => playVoice(item)}>
                <Text style={[styles.bubbleText, item.mine && styles.mineText]}>
                  Voice · {Math.round((item.voice_duration_ms ?? 0) / 1000)}s · tap to play
                </Text>
              </Pressable>
            ) : null}
            {item.attachment_kind === 'image' || item.attachment_kind === 'file' ? (
              <Text style={[styles.bubbleText, item.mine && styles.mineText]}>
                {item.attachment_kind === 'image' ? 'Image' : 'File'} · {item.attachment_name || 'Attachment'}
              </Text>
            ) : null}
            <Text style={[styles.time, item.mine && styles.mineTime]}>
              {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
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
            {reactFor === item.id ? (
              <View style={styles.reactionPicker}>
                {REACTION_EMOJIS.map((e) => (
                  <Pressable key={e} onPress={() => react(item, e)} style={styles.reactionPick}>
                    <Text style={styles.emoji}>{e}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Pressable>
        )}
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

      <View style={styles.composer}>
        <Pressable onPress={() => setShowEmoji((v) => !v)} accessibilityLabel="Emoji" style={styles.toolBtn}>
          <Text style={styles.tool}>{showEmoji ? 'Close' : 'Emoji'}</Text>
        </Pressable>
        <Pressable onPress={sendFile} accessibilityLabel="Attach file" style={styles.toolBtn}>
          <Text style={styles.tool}>File</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.muted}
          multiline
        />
        {draft.trim() ? (
          <Pressable style={styles.send} onPress={() => sendText()} disabled={busy}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={toggleRecord}
            accessibilityLabel={recorderState.isRecording ? 'Stop recording' : 'Record voice'}
            style={styles.toolBtn}
          >
            <Text style={[styles.tool, recorderState.isRecording && { color: colors.error }]}>
              {recorderState.isRecording ? 'Stop' : 'Voice'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
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

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    shell: {
      flex: 1,
      backgroundColor: colors.background,
      overflow: 'hidden',
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
    rowTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.uiSemi },
    muted: { color: colors.muted, fontSize: 13, fontFamily: fonts.ui },
    thread: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 20, gap: 2 },
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
    time: { color: colors.muted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end', fontFamily: fonts.ui },
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
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
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
      minHeight: 40,
      maxHeight: 120,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 10,
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
