import React, { useEffect } from 'react';
import { buzz, HAPTIC } from '../store.jsx';

/* Coming back to Mada: your trips land on the table, the last stamp thunks down, your people arrive one by one. */
export function ReturnHero({ name = 'Omar', people = [['O', 'green'], ['H', 'gold'], ['S', ''], ['A', 'green']], stamp = ['BAKU', 'APR 26'], line = 'Eid is 21 weeks away. Last spring, the four of you were in Baku.' }) {
  useEffect(() => { const t = setTimeout(() => buzz([0, 34]), 1150); return () => clearTimeout(t); }, []);
  return (
    <div className="wb">
      <div className="wb-glow" aria-hidden="true" />
      <div className="wb-photos" aria-hidden="true">
        {[['img/alula.jpg', -14, -86, '.05s'], ['img/riyadh.jpg', 11, 86, '.18s'], ['img/istanbul.jpg', -2, 0, '.32s']].map(([src, r, x, d]) => (
          <span key={src} className="wb-polaroid" style={{ '--r': `${r}deg`, '--x': `${x}px`, animationDelay: d }}><img src={src} alt="" /></span>
        ))}
        <span className="wb-stamp"><b>{stamp[0]}</b><i>{stamp[1]}</i></span>
      </div>
      <div className="wb-people" aria-label={`${people.length} people`}>
        {people.map(([ch, tone], i) => <span key={i} className={'avatar' + (tone ? ' ' + tone : '')} style={{ animationDelay: `${1.3 + i * 0.12}s`, ...(tone ? null : { background: '#f6f2ec', color: '#1e352d' }) }}>{ch}</span>)}
      </div>
      <h1 className="display wb-title">{name ? <>Welcome back,<br />{name}.</> : 'Welcome back.'}</h1>
      <p className="wb-line">{line}</p>
    </div>
  );
}
