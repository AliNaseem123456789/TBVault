import { Link } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import { mapProductForCard } from '../../utils/product';

/** **bold** inside a line -> <strong>. Plain React nodes, no HTML injection. */
const inline = (text) =>
  text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );

/** The assistant may answer with short "- item" lists; show them as real lists. */
const FormattedText = ({ text }) => {
  const blocks = [];
  let list = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!list) blocks.push((list = { type: 'list', items: [] }));
      list.items.push(item[1]);
      return;
    }
    list = null;
    if (line) blocks.push({ type: 'p', text: line, key: i });
  });
  return blocks.map((block, i) =>
    block.type === 'list' ? (
      <ul key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>
    ) : (
      <p key={i}>{inline(block.text)}</p>
    )
  );
};

const ProductChip = ({ product, onOpen }) => {
  const card = mapProductForCard(product);
  return (
    <Link to={`/products/${product.id}`} className="chat-product" onClick={onOpen}>
      <span className="chat-product__media">
        <Icon name="image" size={22} />
        {card.imageUrl && (
          // a photo that fails to load is hidden, leaving the placeholder icon underneath
          <img src={card.imageUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }} />
        )}
      </span>
      <span className="chat-product__body">
        <span className="chat-product__name">{product.name}</span>
        <span className="chat-product__meta">
          <strong>{card.pricePrefix}${card.price}</strong>
          {card.oldPrice && <s>${card.oldPrice}</s>}
          {!card.inStock && <span className="chat-product__out">Sold out</span>}
        </span>
        {product.seller && <span className="chat-product__seller">{product.seller.store_name}</span>}
      </span>
    </Link>
  );
};

/** One bubble. Assistant replies can carry product cards underneath. */
const ChatMessage = ({ message, onOpenProduct }) => {
  const mine = message.role === 'user';
  return (
    <div className={`chat-msg ${mine ? 'chat-msg--user' : 'chat-msg--bot'} ${message.error ? 'chat-msg--error' : ''}`}>
      {(message.imageUrl || message.hadImage) && (
        <div className="chat-msg__photo">
          {message.imageUrl ? <img src={message.imageUrl} alt="Your photo" /> : <span><Icon name="image" size={16} /> Photo</span>}
        </div>
      )}
      {message.content && (
        <div className="chat-msg__bubble">
          {mine ? <p>{message.content}</p> : <FormattedText text={message.content} />}
        </div>
      )}
      {message.products?.length > 0 && (
        <div className="chat-msg__products">
          {message.products.map((p) => <ProductChip key={p.id} product={p} onOpen={onOpenProduct} />)}
        </div>
      )}
    </div>
  );
};

export default ChatMessage;
