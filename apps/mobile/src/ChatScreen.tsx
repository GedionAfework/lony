import {
  AudioModule,
  createAudioPlayer,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
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
  type ConversationMoney,
} from './api';
import { formatMoney } from './amountFormat';
import { apiBaseUrl, fonts, useTheme, type ThemeColors } from './theme';
import { IconAttach, IconBack, IconEmoji, IconLoans, IconMic, IconSend } from './icons';

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
  friends: { peer: { id: string; display_name: string; username?: string | null } }[];
  openLoanId?: string | null;
  openPeerId?: string | null;
  onLoanOpened?: () => void;
  onPeerOpened?: () => void;
  onError: (message: string) => void;
  onOpenProfile?: (peer: { id: string; display_name: string; username?: string | null }) => void;
  onCreateLoanWith?: (peer: { id: string; display_name: string }) => void;
  onOpenLoan?: (loanId: string) => void;
  onActiveChange?: (active: boolean) => void;
};

export function ChatScreen({
  token,
  userId,
  selfInitial,
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
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 200);
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

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    return () => sub.remove();
  }, []);

  async function loadConversations() {
    const res = await api.listConversations(token);
    const list = res.conversations ?? [];
    setConversations(list);
    setActive((prev) => {
      if (!prev) {
        return prev;
      }
      return list.find((c) => c.id === prev.id) ?? prev;
    });
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
      refreshMessages(false).catch(() => undefined);
      loadConversations().catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [active?.id, token]);

  useEffect(() => {
    onActiveChange?.(Boolean(active));
    return () => onActiveChange?.(false);
  }, [active]);

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
      const b64 = await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64 });
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

  async function openSelfChat() {
    await openPeer(userId);
  }

  if (!active) {
    const peerIds = new Set(conversations.map((c) => c.peer.id));
    const startRows = friends.filter((f) => !peerIds.has(f.peer.id));
    const threadRows = (() => {
      const rows = conversations.filter((c) => c.peer.id !== userId);
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
          Chats
        </Text>

        <Pressable
          style={styles.row}
          onPress={() => openSelfChat()}
          onLongPress={() => onOpenProfile?.({ id: userId, display_name: 'Self' })}
          accessibilityRole="button"
          accessibilityLabel="Self"
        >
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>{selfInitial}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>Self</Text>
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
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{f.peer.display_name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{f.peer.display_name}</Text>
              <Text style={styles.muted}>Start chat</Text>
            </View>
          </Pressable>
        ))}
        {threadRows.map((c) => {
          const name =
            c.peer.id === userId || c.peer.display_name === 'Self' || c.peer.display_name === 'Saved Messages'
              ? 'Self'
              : c.peer.display_name;
          const moneyItems = conversationMoneyItems(c);
          return (
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
              onLongPress={() => onOpenProfile?.(c.peer)}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{c.peer.display_name.slice(0, 1).toUpperCase()}</Text>
              </View>
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
                    {c.last_message_mine ? (
                      <Text style={[styles.ticks, { color: c.last_message_read ? '#34B7F1' : colors.muted }]}>
                        ✓
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
      </View>
    );
  }

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
            setActive(null);
            setMessages([]);
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
          <View style={[styles.headerAvatar, isSelfChat && { backgroundColor: colors.primarySoft }]}>
            <Text style={[styles.headerAvatarText, isSelfChat && { color: colors.primary }]}>{peerInitial}</Text>
          </View>
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
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
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
            <View style={styles.bubbleBody}>
              <Text style={[styles.bubbleText, item.mine && styles.mineText]}>
                {item.body
                  ? item.body
                  : item.attachment_kind === 'voice'
                    ? `Voice · ${Math.round((item.voice_duration_ms ?? 0) / 1000)}s`
                    : item.attachment_kind === 'image'
                      ? `Image · ${item.attachment_name || 'Attachment'}`
                      : item.attachment_kind === 'file'
                        ? `File · ${item.attachment_name || 'Attachment'}`
                        : ''}
                <Text style={styles.timeGhost}>
                  {'  '}
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {item.mine ? ' ✓' : ''}
                </Text>
              </Text>
              <View style={styles.timeCornerRow}>
                <Text style={[styles.timeCorner, item.mine && styles.mineTime]}>
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {item.mine ? (
                  <Text style={[styles.tickMark, { color: item.read ? '#34B7F1' : item.mine ? 'rgba(255,255,255,0.55)' : colors.muted }]}>
                    ✓
                  </Text>
                ) : null}
              </View>
            </View>
            {item.attachment_kind === 'voice' ? (
              <Pressable onPress={() => playVoice(item)} hitSlop={8}>
                <Text style={[styles.playHint, item.mine && styles.mineTime]}>Tap to play</Text>
              </Pressable>
            ) : null}
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
        <View style={styles.inputBubble}>
          <Pressable onPress={() => setShowEmoji((v) => !v)} accessibilityLabel="Emoji" style={styles.iconBtn}>
            <IconEmoji size={20} color={showEmoji ? colors.primary : colors.muted} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
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
          <Pressable style={styles.sendIconBtn} onPress={() => sendText()} disabled={busy} accessibilityLabel="Send">
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
    ticks: { color: colors.muted, fontSize: 11, fontFamily: fonts.ui, lineHeight: 12 },
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
    bubbleBody: { position: 'relative' },
    timeGhost: { fontSize: 9, lineHeight: 21, opacity: 0, fontFamily: fonts.ui },
    timeCornerRow: {
      position: 'absolute',
      right: 0,
      bottom: -2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    timeCorner: {
      color: colors.muted,
      fontSize: 9,
      lineHeight: 12,
      fontFamily: fonts.ui,
    },
    tickMark: { fontSize: 11, lineHeight: 12, fontFamily: fonts.ui },
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
