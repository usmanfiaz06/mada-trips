import React, { useRef, useState } from 'react';
import { COVER_COLORS, COVER_COLOR_INFO, COVER_ICONS, COVER_PHOTOS, coverArtSvg } from '../../../../../packages/shared/src/cover-art.ts';
import { buzz, HAPTIC } from '../store.jsx';
import { Icon } from '../ui.jsx';

/*
 * Circle covers (packages/shared/src/cover-art.ts draws the same pictures for the app and the invite page): one of
 * Mada's drawings on a colour (the default), a photo we ship, or your own photo, which only you see until it's
 * checked. A group keeps `cover` ({ kind: 'icon', icon, color } | { kind: 'photo', id } | { kind: 'upload', url,
 * status }); older groups only have `img`, read as a photo.
 */

const OLD = { 'img/istanbul.jpg': 'istanbul', 'img/alula.jpg': 'alula', 'img/riyadh.jpg': 'riyadh' };
export const photoSrc = (id) => (OLD[`img/${id}.jpg`] ? `img/${id}.jpg` : `img/places/${id}.jpg`);
export const ICON_NAMES = {
  plane: 'Plane', suitcase: 'Suitcase', passport: 'Passport', palm: 'Palm tree', camel: 'Camel', tent: 'Desert tent', dallah: 'Dallah', dates: 'Dates',
  beach: 'Beach umbrella', wave: 'Wave', mountain: 'Mountains', snow: 'Snow', ferris: 'Ferris wheel', balloon: 'Hot-air balloon', ship: 'Ferry', train: 'Train',
  car: 'Road trip', pin: 'Map pin', compass: 'Compass', camera: 'Camera', icecream: 'Ice cream', football: 'Football', castle: 'Theme park', sun: 'Sun',
  moon: 'Moon and stars', lantern: 'Lantern', family: 'Family', kids: 'Kids', gift: 'Gift', cake: 'Birthday cake', heart: 'Heart',
};
const COLOR_NAMES = { green: 'Green', sand: 'Sand', gold: 'Gold', sky: 'Sky', rose: 'Rose', sage: 'Sage' };
const PHOTO_NAMES = { istanbul: 'Istanbul', alula: 'AlUla', riyadh: 'Riyadh', 'dubai-skyline': 'Dubai', 'desert-camp': 'Desert camp', 'maldives-overwater': 'Maldives', 'jeddah-al-balad': 'Jeddah', 'abha-mountains': 'Abha', 'baku-old-city': 'Baku' };

/** A group's cover, old or new. */
export function groupCover(g) {
  if (!g) return null;
  if (g.cover !== undefined) return g.cover;
  if (!g.img) return null;
  return OLD[g.img] ? { kind: 'photo', id: OLD[g.img] } : { kind: 'upload', url: g.img, status: 'approved' };
}
/** Light drawings carry ink words; photos and the green carry paper words. */
export const coverLight = (c) => c?.kind === 'icon' && COVER_COLOR_INFO[c.color]?.text === 'ink';
const rtl = () => typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

/** The cover as a background layer. w × h is the drawing's own shape; it fills whatever holds it. */
export function CoverBg({ cover, w = 360, h = 200, layout = 'banner', className = '' }) {
  if (!cover) return <span className={'cover-bg plain ' + className} aria-hidden="true" />;
  if (cover.kind === 'icon') {
    const svg = coverArtSvg(cover, { width: w, height: h, layout, side: rtl() ? 'left' : 'right', fill: true });
    return <span className={'cover-bg art ' + className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  const src = cover.kind === 'photo' ? photoSrc(cover.id) : cover.url;
  return <img className={'cover-bg ' + className} src={src} alt="" style={cover.kind === 'photo' ? { objectPosition: COVER_PHOTOS[cover.id]?.focal } : null} />;
}

/** "Only you see this until it's checked." */
export function CoverStatus({ cover, onDark }) {
  if (cover?.kind !== 'upload' || cover.status === 'approved') return null;
  const bad = cover.status === 'rejected';
  return (
    <span className={'cover-status' + (onDark ? ' dark' : '') + (bad ? ' bad' : '')} role={bad ? 'alert' : undefined}>
      <Icon name={bad ? 'close' : 'lock'} size={14} />{bad ? 'We couldn’t use this photo. The circle keeps the cover it had.' : 'Only you see this until it’s checked'}
    </span>
  );
}

/** Icons (default) · Photos · Your photo. */
export function CoverPicker({ value, onChange }) {
  const [tab, setTab] = useState(value?.kind === 'photo' ? 'photos' : value?.kind === 'upload' ? 'upload' : 'icons');
  const [color, setColor] = useState(value?.kind === 'icon' ? value.color : 'green');
  const [upload, setUpload] = useState(value?.kind === 'upload' ? value : null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const file = useRef(null);
  const icon = value?.kind === 'icon' ? value.icon : null;
  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|heic)$/.test(f.type)) { setProblem('That file isn’t a photo. Choose a JPEG or PNG.'); buzz(HAPTIC.soft); return; }
    if (f.size > 10 * 1024 * 1024) { setProblem('That photo is over 10 MB. Choose one under 10 MB.'); buzz(HAPTIC.soft); return; }
    setProblem(null); setBusy(true);
    const r = new FileReader();
    r.onload = () => { const c = { kind: 'upload', url: String(r.result), status: 'pending' }; setUpload(c); onChange(c); setBusy(false); buzz(HAPTIC.success); };
    r.onerror = () => { setBusy(false); setProblem('That file isn’t a photo. Choose a JPEG or PNG.'); };
    r.readAsDataURL(f);
  };
  return (
    <div className="col cover-picker" style={{ gap: 14 }}>
      <div className="seg" role="radiogroup" aria-label="Cover">
        {[['icons', 'Icons'], ['photos', 'Photos'], ['upload', 'Your photo']].map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={tab === k ? 'true' : 'false'} onClick={() => { setTab(k); buzz(HAPTIC.select); if (k === 'upload' && upload) onChange(upload); }}>{l}</button>
        ))}
      </div>
      {tab === 'icons' && <>
        <div className="cover-grid" role="radiogroup" aria-label="Drawings">
          {COVER_ICONS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={icon === k ? 'true' : 'false'} aria-label={ICON_NAMES[k]} className={'cover-cell' + (icon === k ? ' on' : '')}
              onClick={() => { onChange({ kind: 'icon', icon: k, color }); buzz(HAPTIC.select); }}>
              <CoverBg cover={{ kind: 'icon', icon: k, color }} w={48} h={48} layout="badge" />
            </button>
          ))}
        </div>
        <div className="col" style={{ gap: 8 }}>
          <span className="small" style={{ fontWeight: 600 }}>Background colour</span>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }} role="radiogroup" aria-label="Background colour">
            {COVER_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c ? 'true' : 'false'} aria-label={`${COLOR_NAMES[c]} background`} className={'cover-dot' + (color === c ? ' on' : '')}
                style={{ background: COVER_COLOR_INFO[c].bg }} onClick={() => { setColor(c); onChange({ kind: 'icon', icon: icon || 'plane', color: c }); buzz(HAPTIC.select); }} />
            ))}
          </div>
        </div>
      </>}
      {tab === 'photos' && (
        <div className="col" style={{ gap: 8 }}>
          <div className="cover-grid" role="radiogroup" aria-label="Photos">
            <button type="button" role="radio" aria-checked={value === null ? 'true' : 'false'} aria-label="Plain green" className={'cover-photo' + (value === null ? ' on' : '')} style={{ background: '#1e352d' }} onClick={() => { onChange(null); buzz(HAPTIC.select); }} />
            {Object.keys(COVER_PHOTOS).map((id) => {
              const on = value?.kind === 'photo' && value.id === id;
              return (
                <button key={id} type="button" role="radio" aria-checked={on ? 'true' : 'false'} aria-label={PHOTO_NAMES[id]} className={'cover-photo' + (on ? ' on' : '')} onClick={() => { onChange({ kind: 'photo', id }); buzz(HAPTIC.select); }}>
                  <img src={photoSrc(id)} alt="" /><span>{PHOTO_NAMES[id]}</span>
                </button>
              );
            })}
          </div>
          {value?.kind === 'photo' && COVER_PHOTOS[value.id].credit && <span className="tiny">Photo: {COVER_PHOTOS[value.id].credit}</span>}
        </div>
      )}
      {tab === 'upload' && (
        <div className="card well col" style={{ gap: 10 }}>
          {upload ? (
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <span className="cover-thumb"><CoverBg cover={upload} /></span>
              <CoverStatus cover={{ ...upload, status: 'pending' }} />
            </div>
          ) : <span className="small">A photo from your phone, cropped to fit. We check it before the rest of the circle sees it.</span>}
          <input ref={file} type="file" accept="image/*" hidden onChange={pick} aria-label="Choose a photo" />
          <button type="button" className={'btn small ' + (upload ? 'secondary' : 'primary')} style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => file.current?.click()}>
            <Icon name="scan" size={18} />{busy ? 'Adding your photo' : upload ? 'Choose another' : 'Choose a photo'}
          </button>
          {upload && <span className="tiny">A photo from your phone, cropped to fit. We check it before the rest of the circle sees it.</span>}
          {problem && <span className="err" role="alert">{problem}</span>}
        </div>
      )}
    </div>
  );
}
