import React, { useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, fmt } from '../store.jsx';
import { Icon, TopBar, Sheet, PayMark, PermissionDenied } from '../ui.jsx';
import { CardsSheet } from './Pay.jsx';
import { UserAvatar, PhotoSheet, LanguageSheet, LangName, DeletionBanner, Group, Row, useAccount, SignOutSheet, displayName, passportName, prettyPhone, householdIds, passportStatus, MEALS } from './Account.jsx';

export default function Profile() {
  const { s, set, pop, push, toast } = useStore();
  const [a] = useAccount();
  const [sheet, setSheet] = useState(null);
  const [removeId, setRemoveId] = useState(null);

  if (s.guest) {
    return (
      <div className="screen push">
        <TopBar onBack={pop} />
        <div className="scroll no-dock">
          <h1 className="h1">You’re tracking a flight.</h1>
          <p className="body">Sign in to book, keep your trips and add your family’s passports.</p>
          <button type="button" className="btn primary block" onClick={() => set({ onboarded: false, guest: false, stack: [] })}>Sign in</button>
          <Group><Row icon="doc" value="Help" onClick={() => push('accountHelp')} /></Group>
        </div>
      </div>
    );
  }

  const ids = householdIds(s);
  const needs = ids.filter((id) => ['none', 'soon', 'problem', 'expired'].includes(passportStatus(s, id).key)).length;
  const isApplePay = s.defaultCard === 'applepay';
  const credit = s.credit?.balance || 0;
  const methods = [a.methods.apple && 'Apple', a.methods.google && 'Google', a.methods.phone && 'Phone'].filter(Boolean);
  const p = a.prefs;
  const seat = { window: 'Window', aisle: 'Aisle', any: 'Any seat' }[p.seat];
  const meal = (MEALS.find((m) => m[0] === p.meal) || [])[1];

  return (
    <div className="screen push">
      <TopBar onBack={pop} />
      <div className="scroll no-dock">
        <div className="row acc-head">
          <button type="button" className={'acc-avatar-wrap' + (a.photo ? '' : ' empty')} aria-label={a.photo ? 'Change photo' : 'Add a photo'} onClick={() => { buzz(HAPTIC.tap); setSheet('photo'); }}>
            <UserAvatar size={68} />
            <span className="acc-cam"><Icon name="plus" size={14} color="#1e352d" width={2.6} /></span>
          </button>
          <button type="button" className="col grow acc-namebtn" onClick={() => push('account')}>
            <h1 className="h1" style={{ fontSize: 26 }}>{a.preferred || passportName(s) || 'Your account'}</h1>
            <span className="small num">{a.phone.digits ? prettyPhone(a.phone.digits) : a.email?.address || (s.passportSaved ? 'Add a mobile number' : 'Add your passport to fill in your name')}</span>
            <span className="acc-link">Your details <Icon name="chevron" size={14} width={2.4} /></span>
          </button>
        </div>

        {a.deleteAt && <DeletionBanner />}

        <Group label="Account">
          <Row icon="user" value="Your details" sub="Name, email, phone, home airport" onClick={() => push('account')} />
          <Row icon="lock" value="Sign-in methods" sub={methods.join(' · ') || 'None'} onClick={() => push('accountSignin')} />
          <Row icon="flight" value="Travel preferences" sub={`${seat} · ${meal}${p.loyalty.length ? ` · ${p.loyalty.length} loyalty ${p.loyalty.length === 1 ? 'number' : 'numbers'}` : ' · no loyalty numbers yet'}`} onClick={() => push('accountPrefs')} />
        </Group>

        <Group label="Household">
          <Row lead={<span className="stack">{ids.slice(0, 4).map((id) => (id === 'omar' ? <UserAvatar key={id} size={34} ring="#fffdf9" /> : <span key={id} className="avatar" style={{ width: 34, height: 34, fontSize: 13, boxShadow: '0 0 0 2px #fffdf9' }}>{PEOPLE[id].initial}</span>))}</span>}
            value={ids.length > 1 ? ids.map((id) => (id === 'omar' ? displayName(s) || 'You' : PEOPLE[id].name)).join(', ') : 'Just you'}
            sub={ids.length <= 1 ? (needs ? 'Your passport isn’t scanned yet · add your family' : 'Add your family to book for everyone') : needs ? `${needs} ${needs === 1 ? 'passport needs' : 'passports need'} a look` : 'Everyone’s passport is scanned'}
            onClick={() => push('household')} />
        </Group>

        <Group label="Paying">
          {isApplePay && <Row lead={<PayMark brand="applepay" size={26} />} value="Apple Pay" right={<span className="pill ok">Default</span>} />}
          {s.cards.map((c) => (
            <Row key={c.id} lead={<PayMark brand={c.brand} size={26} />} value={c.label} sub={c.exp ? `Expires ${c.exp}` : null}
              right={<span className="row" style={{ gap: 8 }}>{c.id === s.defaultCard && <span className="pill ok">Default</span>}<button type="button" className="link" style={{ color: '#8a3524', fontSize: 13 }} aria-label={`Remove ${c.label}`} onClick={() => {
                if (c.id === s.defaultCard && s.cards.length > 1) setRemoveId(c.id);
                else if (c.id === s.defaultCard) setSheet('lastcard');
                else { set((x) => ({ cards: x.cards.filter((y) => y.id !== c.id) })); toast('Card removed.'); }
              }}>Remove</button></span>} />
          ))}
          {!s.cards.length && !isApplePay && <Row icon="card" value="No cards saved" sub="Add one when you book, or now." />}
          {!s.cards.length && isApplePay && <div className="acc-row"><span className="tiny">No cards saved. Apple Pay works on this phone.</span></div>}
          {credit > 0 && <Row lead={<PayMark brand="credit" size={26} />} value={`SAR ${fmt(credit)} Mada credit`} sub="Used first on your next booking." />}
          <Row icon="card" value={s.cards.length ? 'Change default or add a card' : 'Add a card'} onClick={() => setSheet('cards')} />
        </Group>

        <Group label="Alerts">
          <div className="acc-row col" style={{ alignItems: 'stretch', gap: 10 }}>
            <div className="chips" role="radiogroup" aria-label="How often we alert you">
              {[['quiet', 'Quiet'], ['everything', 'Everything']].map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={s.settings.alerts === id ? 'true' : 'false'} className={'chip' + (s.settings.alerts === id ? ' on' : '')} onClick={() => { set((x) => ({ settings: { ...x.settings, alerts: id } })); buzz(HAPTIC.select); }}>{label}</button>
              ))}
            </div>
            <span className="small">{s.settings.alerts === 'quiet' ? 'Only when you need to act: gate changes, delays, leave-now, documents. Everything else waits for the evening digest.' : 'Every update about your trips as it happens. Still never offers.'}</span>
            {s.demo.permissionsDenied ? <button type="button" className="link alerts-off" style={{ alignSelf: 'flex-start', padding: 0, color: '#7d5d27', textAlign: 'start' }} onClick={() => setSheet('alertsOff')}>Alerts are off for Mada on this phone. Turn them on</button>
              : s.notifications === false && <span className="small" style={{ color: '#7d5d27' }}>Alerts are off for Mada on this phone. Turn them on in Settings to get gate changes.</span>}
          </div>
        </Group>

        <Group label="App">
          <Row icon="globe" value="Language" sub={<LangName />} onClick={() => setSheet('language')} />
          <Row icon="lock" value="Security" sub={`${a.faceId ? 'Face ID on' : 'Face ID off'} · ${a.devices.length} ${a.devices.length === 1 ? 'device' : 'devices'}`} onClick={() => push('accountSecurity')} />
          <Row icon="doc" value="Privacy and data" sub={a.exportAt && Date.now() - a.exportAt < 86400000 ? 'Your data is on its way by email' : 'Download, delete, what we keep'} onClick={() => push('accountPrivacy')} />
          <Row icon="bell" value="Help" sub="Questions, talk to Mada, terms" onClick={() => push('accountHelp')} />
        </Group>

        <button type="button" className="btn secondary block" onClick={() => setSheet('signout')}>Sign out</button>
        <span className="tiny" style={{ textAlign: 'center' }}>Mada Trips 1.0 (build 1)</span>
      </div>

      {sheet === 'photo' && <PhotoSheet onClose={() => setSheet(null)} />}
      {sheet === 'language' && <LanguageSheet onClose={() => setSheet(null)} />}
      {sheet === 'alertsOff' && <PermissionDenied kind="notifications" onClose={() => setSheet(null)} onManual={() => { setSheet(null); toast('Alerts by SMS are on. Gate changes and delays go to your number.'); }} />}
      {sheet === 'cards' && <CardsSheet current={s.defaultCard} onPick={(id) => { const changed = id !== s.defaultCard; set({ defaultCard: id }); setSheet(null); toast(changed ? `${id === 'applepay' ? 'Apple Pay' : (s.cards.find((c) => c.id === id)?.label || 'that card')} is your default now.` : 'That’s already your default.'); }} onClose={() => setSheet(null)} />}
      {removeId && (
        <Sheet label="Remove default card" onClose={() => setRemoveId(null)}>
          <h2 className="h2">That's your default card.</h2>
          <p className="body">Pick what to use from now on, then we'll remove it.</p>
          {s.cards.filter((c) => c.id !== removeId).map((c) => (
            <button key={c.id} type="button" className="card tap well" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => { set((x) => ({ cards: x.cards.filter((y) => y.id !== removeId), defaultCard: c.id })); setRemoveId(null); toast('Card removed.'); }}><PayMark brand={c.brand} size={24} /><span className="h3" style={{ fontSize: 15 }}>Use {c.label}</span></button>
          ))}
          <button type="button" className="card tap well" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => { set((x) => ({ cards: x.cards.filter((y) => y.id !== removeId), defaultCard: 'applepay' })); setRemoveId(null); toast('Card removed. Apple Pay is your default.'); }}><PayMark brand="applepay" size={24} /><span className="h3" style={{ fontSize: 15 }}>Use Apple Pay</span></button>
        </Sheet>
      )}
      {sheet === 'lastcard' && (
        <Sheet label="Remove card" onClose={() => setSheet(null)}>
          <h2 className="h2">Remove your only card?</h2>
          <p className="body">You can still pay with Apple Pay. Add a card any time when you book.</p>
          <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => { set((x) => ({ cards: [], defaultCard: 'applepay' })); setSheet(null); toast('Card removed. Apple Pay is your default.'); }}>Remove card</button>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Keep it</button>
        </Sheet>
      )}
      {sheet === 'signout' && <SignOutSheet onClose={() => setSheet(null)} />}
    </div>
  );
}
