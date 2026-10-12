import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sendChat, sendChatImage } from '../../api/chatbot.api';
import { cancelOrder } from '../../api/orders.api';

/**
 * One conversation shared by the floating widget and the full /chat page,
 * so opening the page keeps what you were talking about.
 *
 * A message looks like:
 *   { id, role: 'user' | 'assistant', content, imageUrl?, error?,
 *     products?, orders?, sources?, action?, state? }      (assistant extras)
 * `state` (what that reply searched for) is sent back with the next message so
 * follow-ups like "only Sony under $200" refine the previous search.
 * Text messages survive a page reload (sessionStorage); attached photos don't.
 */
const ChatContext = createContext(null);
const STORAGE_KEY = 'tbvault.chat';
const HISTORY_SENT = 6; // earlier messages the assistant sees, for natural follow-ups

const readSaved = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

const errorText = (err) =>
  err?.response?.data?.message ?? 'Something went wrong. Please try again.';

let nextId = Date.now();
const newId = () => ++nextId;

export const ChatProvider = ({ children }) => {
  const [messages, setMessages] = useState(readSaved);
  const [sending, setSending] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(false);

  useEffect(() => {
    try {
      // object URLs of photos die with the page, so they aren't saved
      const saveable = messages.map(({ imageUrl, ...rest }) => (imageUrl ? { ...rest, hadImage: true } : rest));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saveable.slice(-40)));
    } catch {
      /* storage unavailable: the chat just isn't kept across reloads */
    }
  }, [messages]);

  const ask = useCallback(async (userMessage, request) => {
    setMessages((list) => [...list, userMessage]);
    setSending(true);
    try {
      const res = await request();
      const { answer, products = [], orders = [], sources = [], action = null, state = null } = res.data;
      setMessages((list) => [...list, { id: newId(), role: 'assistant', content: answer, products, orders, sources, action, state }]);
    } catch (err) {
      setMessages((list) => [...list, { id: newId(), role: 'assistant', content: errorText(err), error: true }]);
    } finally {
      setSending(false);
    }
  }, []);

  const send = useCallback(
    (text) => {
      const message = text.trim();
      if (!message) return;
      const history = messages
        .filter((m) => !m.error && m.content)
        .slice(-HISTORY_SENT)
        .map(({ role, content }) => ({ role, content }));
      const lastState = [...messages].reverse().find((m) => m.role === 'assistant' && m.state)?.state ?? null;
      return ask({ id: newId(), role: 'user', content: message }, () => sendChat(message, history, lastState));
    },
    [ask, messages]
  );

  /**
   * The cancel button under a reply. Only this click cancels: it calls the normal
   * POST /orders/:id/cancel (the backend checks ownership and status again).
   * choice: 'confirm' | 'dismiss'
   */
  const resolveAction = useCallback(async (messageId, choice) => {
    const target = messages.find((m) => m.id === messageId);
    if (!target?.action || target.action.status) return;
    const setStatus = (status) =>
      setMessages((list) => list.map((m) => (m.id === messageId ? { ...m, action: { ...m.action, status } } : m)));
    const { order_id: orderId } = target.action;
    if (choice === 'dismiss') {
      setStatus('dismissed');
      setMessages((list) => [...list, { id: newId(), role: 'assistant', content: `OK, order #${orderId} stays as it is.` }]);
      return;
    }
    setStatus('working');
    try {
      await cancelOrder(orderId);
      setStatus('done');
      setMessages((list) => [...list, { id: newId(), role: 'assistant', content: `Order #${orderId} has been cancelled. Any card payment is being refunded, and store credit used on it is back in your balance.`, orders: [{ order_id: orderId, status: 'cancelled' }] }]);
    } catch (err) {
      setStatus('failed');
      setMessages((list) => [...list, { id: newId(), role: 'assistant', content: errorText(err), error: true }]);
    }
  }, [messages]);

  const sendImage = useCallback(
    (file, text = '') => {
      const message = text.trim();
      const imageUrl = URL.createObjectURL(file);
      return ask({ id: newId(), role: 'user', content: message, imageUrl }, () => sendChatImage(file, message));
    },
    [ask]
  );

  const reset = useCallback(() => setMessages([]), []);

  const value = useMemo(
    () => ({ messages, sending, send, sendImage, resolveAction, reset, widgetOpen, setWidgetOpen }),
    [messages, sending, send, sendImage, resolveAction, reset, widgetOpen]
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
};
