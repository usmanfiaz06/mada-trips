import React, { useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE } from '../store.jsx';
import { Icon, TopBar, Sheet } from '../ui.jsx';
import { CardsSheet } from './Pay.jsx';

export default function Profile() {
  const { s, set, pop, go, toast, hardReset } = useStore();
  const [sheet, setSheet] = useState(null);
  const [removeId, setRemoveId] = useState(null);
  const Row = ({ icon, title, sub, onClick, danger }) => (
    <button type="button" className="card tap" onClick={onClick} style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Icon name={icon} color={danger ? '#8a3524' : undefined} />
      <span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15, color: danger ? '#8a3524' : undefined }}>{title}</span>{sub && <span className="tiny">{sub}</span>}</span>
      <Icon name="chevron" />
    </button>
  );
  return (
    <div className="screen push">
      <TopBar onBack={pop} />
      <div className="scroll no-dock">
        <div className="row"><span className="avatar green" style={{ width: 56, height: 56, fontSize: 22 }}>{s.user?.name?.charAt(0) || 'O'}</span><div className="col" style={{ gap: 0 }}><h1 className="h1">{s.user?.name || 'Omar'} Alharbi</h1><span className="small">+966 5• ••• 4127</span></div></div>

        <span className="eyebrow">Household</span>
        <Row icon="circles" title={s.household.map((id) => PEOPLE[id].name).join(', ') || 'Just you'} sub="Documents for everyone live in the Wallet" onClick={() => go('wallet')} />

        <span className="eyebrow">Paying</span>
        <Row icon="card" title={(s.cards.find((c) => c.id === s.defaultCard) || s.cards[0])?.label || 'No card'} sub={`${s.cards.length} saved · tap to change the default`} onClick={() => setSheet('cards')} />
        {s.cards.length > 1 && s.cards.map((c) => (
          <div key={c.id} className="spread small" style={{ padding: '0 6px' }}>
            <span>{c.label}{c.id === s.defaultCard ? ' · default' : ''}</span>
            <button type="button" className="link" style={{ color: '#8a3524', fontSize: 13 }} onClick={() => { if (c.id === s.defaultCard) setRemoveId(c.id); else { set((p) => ({ cards: p.cards.filter((x) => x.id !== c.id) })); toast('Card removed.'); } }}>Remove</button>
          </div>
        ))}

        <span className="eyebrow">Alerts</span>
        <div className="card" style={{ gap: 12 }}>
          <div className="chips" role="radiogroup" aria-label="How often we alert you">
            {[['quiet', 'Quiet'], ['everything', 'Everything']].map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={s.settings.alerts === id ? 'true' : 'false'} className={'chip' + (s.settings.alerts === id ? ' on' : '')} onClick={() => { set((p) => ({ settings: { ...p.settings, alerts: id } })); buzz(HAPTIC.select); }}>{label}</button>
            ))}
          </div>
          <span className="small">{s.settings.alerts === 'quiet' ? 'Only when you need to act: gate changes, delays, leave-now, documents. Everything else waits for the evening digest.' : 'Every update about your trips as it happens. Still never offers.'}</span>
          {s.notifications === false && <span className="small" style={{ color: '#7d5d27' }}>Alerts are off for Mada on this phone. Turn them on in Settings to get gate changes.</span>}
        </div>

        <span className="eyebrow">Language</span>
        <div className="card" style={{ flexDirection: 'row', alignItems: 'center' }}><Icon name="globe" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>English</span><span className="tiny">العربية comes in the next round of the prototype</span></span></div>

        <span className="eyebrow">Your data</span>
        <Row icon="doc" title="Download everything" sub="Trips, documents, payments" onClick={() => toast('We’ll email a copy within 24 hours.')} />
        <Row icon="lock" title="Delete my account" onClick={() => setSheet('delete')} danger />
        <button type="button" className="btn secondary block" onClick={() => setSheet('signout')}>Sign out</button>
      </div>

      {sheet === 'cards' && <CardsSheet current={s.defaultCard} onPick={(id) => { if (id !== 'applepay') set({ defaultCard: id }); setSheet(null); toast('Default card updated.'); }} onClose={() => setSheet(null)} />}
      {removeId && (
        <Sheet label="Remove default card" onClose={() => setRemoveId(null)}>
          <h2 className="h2">That's your default card.</h2>
          <p className="body">Pick the card to use from now on, then we'll remove it.</p>
          {s.cards.filter((c) => c.id !== removeId).map((c) => (
            <button key={c.id} type="button" className="card tap well" onClick={() => { set((p) => ({ cards: p.cards.filter((x) => x.id !== removeId), defaultCard: c.id })); setRemoveId(null); toast('Card removed.'); }}><span className="h3" style={{ fontSize: 15 }}>Use {c.label}</span></button>
          ))}
        </Sheet>
      )}
      {sheet === 'delete' && (
        <Sheet label="Delete account" onClose={() => setSheet(null)}>
          <h2 className="h2">Delete your account?</h2>
          <p className="body">Your trips, documents and points will be deleted. Bookings already made stay with the airline and hotel.</p>
          <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => { hardReset(); }}>Delete my account</button>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Keep it</button>
        </Sheet>
      )}
      {sheet === 'signout' && (
        <Sheet label="Sign out" onClose={() => setSheet(null)}>
          <h2 className="h2">Sign out?</h2>
          <p className="body">Your trips stay in your account. Documents stay encrypted on this phone until you sign in again.</p>
          <button type="button" className="btn primary block" onClick={() => hardReset()}>Sign out</button>
          <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Cancel</button>
        </Sheet>
      )}
    </div>
  );
}
