import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sendChat, sendChatImage } from '../../api/chatbot.api';

/**
 * One conversation shared by the floating widget and the full /chat page,
 * so opening the page keeps what you were talking about.
 *
 * A message looks like:
 *   { id, role: 'user' | 'assistant', content, imageUrl?, products?, error? }
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
      const { answer, products = [] } = res.data;
      setMessages((list) => [...list, { id: newId(), role: 'assistant', content: answer, products }]);
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
      return ask({ id: newId(), role: 'user', content: message }, () => sendChat(message, history));
    },
    [ask, messages]
  );

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
    () => ({ messages, sending, send, sendImage, reset, widgetOpen, setWidgetOpen }),
    [messages, sending, send, sendImage, reset, widgetOpen]
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
};
