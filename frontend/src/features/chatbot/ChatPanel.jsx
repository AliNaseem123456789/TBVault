import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/ui/Icon';
import { useChat } from './ChatProvider';
import ChatMessage from './ChatMessage';

const SUGGESTIONS = [
  'Wireless earbuds under $100',
  'A gift for a coffee lover',
  'Laptops in stock',
  'Something to keep my phone charged',
];
const MAX_PHOTO = 5 * 1024 * 1024;

/**
 * The conversation + message box. Used by the floating widget (compact)
 * and the /chat page (roomy). Enter sends, Shift+Enter adds a new line.
 * The camera button attaches a photo to search by look.
 */
const ChatPanel = ({ variant = 'widget', onOpenProduct }) => {
  const { messages, sending, send, sendImage } = useChat();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState(null); // { file, url }
  const [photoError, setPhotoError] = useState('');
  const listRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, sending]);

  useEffect(() => () => photo && URL.revokeObjectURL(photo.url), [photo]);

  const pickPhoto = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setPhotoError('Please choose an image file.');
    if (file.size > MAX_PHOTO) return setPhotoError('Photos must be 5 MB or smaller.');
    setPhotoError('');
    setPhoto({ file, url: URL.createObjectURL(file) });
  };

  const submit = (e) => {
    e?.preventDefault();
    if (sending) return;
    if (photo) {
      sendImage(photo.file, text);
      setPhoto(null);
    } else if (text.trim()) {
      send(text);
    } else {
      return;
    }
    setText('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) submit(e);
  };

  return (
    <div className={`chat-panel chat-panel--${variant}`}>
      <div className="chat-panel__list" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            <span className="chat-empty__icon"><Icon name="chat" size={26} /></span>
            <h3>What are you shopping for?</h3>
            <p>Describe it in your own words, set a budget, or send a photo and I'll find similar products.</p>
            <div className="chat-empty__chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chat-chip" onClick={() => send(s)} disabled={sending}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => <ChatMessage key={m.id} message={m} onOpenProduct={onOpenProduct} />)}
        {sending && (
          <div className="chat-msg chat-msg--bot">
            <div className="chat-msg__bubble chat-typing" aria-label="Assistant is typing"><span /><span /><span /></div>
          </div>
        )}
      </div>

      <form className="chat-composer" onSubmit={submit}>
        {photo && (
          <div className="chat-composer__photo">
            <img src={photo.url} alt="Selected" />
            <span>Search by this photo</span>
            <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo"><Icon name="close" size={16} /></button>
          </div>
        )}
        {photoError && <p className="chat-composer__error">{photoError}</p>}
        <div className="chat-composer__row">
          <button type="button" className="chat-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Search with a photo" title="Search with a photo">
            <Icon name="camera" size={20} />
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden onChange={pickPhoto} />
          <textarea
            className="chat-composer__input"
            rows={1}
            maxLength={1000}
            placeholder={photo ? 'Add a note (optional), e.g. "under $50"' : 'Ask about any product…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Message"
          />
          <button type="submit" className="chat-send" disabled={sending || (!text.trim() && !photo)} aria-label="Send">
            <Icon name="send" size={18} />
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatPanel;
