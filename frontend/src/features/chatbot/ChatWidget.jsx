import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import { useChat } from './ChatProvider';
import ChatPanel from './ChatPanel';
import './Chat.css';

/**
 * Floating assistant in the corner of every storefront page.
 * The expand button opens the same conversation on the full /chat page.
 */
const ChatWidget = () => {
  const { widgetOpen, setWidgetOpen, reset, messages } = useChat();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (pathname.startsWith('/chat')) return null;

  const openFullPage = () => {
    setWidgetOpen(false);
    navigate('/chat');
  };

  return (
    <div className="chat-widget">
      {widgetOpen && (
        <section className="chat-widget__window" aria-label="Shopping assistant">
          <header className="chat-widget__header">
            <div>
              <h2>Shopping assistant</h2>
              <p>Ask anything, or search with a photo</p>
            </div>
            <div className="chat-widget__actions">
              {messages.length > 0 && (
                <button type="button" className="chat-widget__text-btn" onClick={reset}>New chat</button>
              )}
              <button type="button" className="chat-icon-btn" onClick={openFullPage} aria-label="Open full chat page" title="Open full page">
                <Icon name="expand" size={18} />
              </button>
              <button type="button" className="chat-icon-btn" onClick={() => setWidgetOpen(false)} aria-label="Close chat">
                <Icon name="close" size={18} />
              </button>
            </div>
          </header>
          <ChatPanel variant="widget" />
        </section>
      )}
      <button
        type="button"
        className={`chat-widget__launcher ${widgetOpen ? 'is-open' : ''}`}
        onClick={() => setWidgetOpen(!widgetOpen)}
        aria-label={widgetOpen ? 'Close shopping assistant' : 'Open shopping assistant'}
        aria-expanded={widgetOpen}
      >
        <Icon name={widgetOpen ? 'close' : 'chat'} size={24} />
      </button>
    </div>
  );
};

export default ChatWidget;
