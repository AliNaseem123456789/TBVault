import { useEffect, useRef, useState } from 'react';

/**
 * Wraps any element and adds the `.reveal` / `.is-visible` classes
 * (defined in src/styles/global.css) once it scrolls into view.
 * This is the standard entrance animation for every new page —
 * wrap a section (or a grid item, for a staggered effect) in
 * <Reveal> instead of inventing new animation CSS.
 *
 *   <Reveal><section>...</section></Reveal>
 *   <Reveal as="li" delay={2}>...</Reveal>   // delay: 1-4, staggers via CSS
 */
const Reveal = ({ children, as: Tag = 'div', delay, className = '', ...rest }) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const delayClass = delay ? `reveal-delay-${delay}` : '';

  return (
    <Tag ref={ref} className={`reveal ${delayClass} ${visible ? 'is-visible' : ''} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
};

export default Reveal;
