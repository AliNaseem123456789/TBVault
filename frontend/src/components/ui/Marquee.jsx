import './Marquee.css';

/**
 * Infinite horizontal scrolling strip. Pass an array of short
 * strings as `items` — the list is duplicated automatically so the
 * loop is seamless. Used for the top announcement bar and the
 * mid-page promo strip; reuse it for any future scrolling banner
 * instead of writing new @keyframes.
 *
 *   <Marquee items={['Free shipping', 'New drops weekly']} tone="accent" />
 *
 * tone: 'ink' | 'accent'
 */
const Marquee = ({ items = [], tone = 'ink' }) => {
  const track = [...items, ...items];
  return (
    <div className={`marquee marquee-${tone}`}>
      <div className="marquee-track">
        {track.map((item, i) => (
          <span className="marquee-item" key={i}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
};

export default Marquee;
