import { useChat } from '../../features/chatbot/ChatProvider';
import ChatPanel from '../../features/chatbot/ChatPanel';
import '../../features/chatbot/Chat.css';

/** Full-page version of the assistant: same conversation as the floating widget. */
const ChatPage = () => {
  const { messages, reset } = useChat();
  return (
    <section className="chat-page container">
      <header className="chat-page__header">
        <div>
          <span className="chat-page__eyebrow">AI shopping assistant</span>
          <h1>Find it by describing it</h1>
          <p>Ask in your own words, add a budget like “under $50”, or send a photo to find products that look alike.</p>
        </div>
        {messages.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>New chat</button>
        )}
      </header>
      <ChatPanel variant="page" />
      <p className="chat-page__note">Answers are based on products in the shop right now. Prices and stock are always live.</p>
    </section>
  );
};

export default ChatPage;
