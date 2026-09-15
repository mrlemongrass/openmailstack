import { useLayoutEffect, useRef, useState } from 'react';
import { correctMessageContrast } from '../message-contrast';

/** html has already passed the message sanitizer and remote-content policy. */
export function EmailBody({ html }: { html: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [readableColors, setReadableColors] = useState(false);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const render = () => {
      // Start from the sender's markup each time, including on a theme change.
      body.innerHTML = html;
      body.style.removeProperty('color');
      body.classList.toggle('message-body-readable', readableColors);
      if (!readableColors && !correctMessageContrast(body)) {
        body.classList.add('message-body-readable');
      }
    };
    render();
    const observer = new MutationObserver(render);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => observer.disconnect();
  }, [html, readableColors]);

  return (
    <>
      <div className="message-reading-controls">
        <button type="button" className="btn btn-ghost" aria-pressed={readableColors}
          onClick={() => setReadableColors(value => !value)}
          title="Use simple text and background colors for difficult emails">
          Readable colors
        </button>
      </div>
      <div ref={bodyRef} className="message-body message-body-contrast" />
    </>
  );
}
