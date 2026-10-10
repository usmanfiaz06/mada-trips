import React, { useEffect, useRef, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, MRZ, passportIssue, shortDay, seatText } from '../store.jsx';
import { Icon, Sun, Sheet, AirlineMark, PayMark } from '../ui.jsx';
import { CardsSheet } from './Pay.jsx';
import { checkFile, readPassport } from '../ocr.js';

export default function Wallet() {
  const { s, set } = useStore();
  if (!s.walletUnlocked && s.account?.faceId !== false) return <Lock />;
  return <Unlocked />;
}

function Lock() {
  const { s, set } = useStore();
  const [state, setState] = useState('idle');
  const [code, setCode] = useState('');
  const tryFace = () => {
    setState('checking');
    setTimeout(() => {
      if (s.demo.faceIdFails) { setState('failed'); buzz(HAPTIC.soft); }
      else { buzz(HAPTIC.success); set({ walletUnlocked: true }); }
    }, 900);
  };
  useEffect(() => { tryFace(); }, []);
  return (
    <div className="screen dark" style={{ alignItems: 'center', justifyContent: 'center', gap: 20, padding: '0 32px', textAlign: 'center' }}>
      <span className="icon-btn" style={{ width: 72, height: 72, background: 'rgba(233,226,216,.12)' }}><Icon name="lock" color="#d9b77a" size={30} /></span>
      <h1 className="h1" style={{ color: '#f6f2ec' }}>Wallet is locked</h1>
      <p className="body" style={{ color: '#c9c1b4' }}>Passports and visas for the whole family. Stored encrypted, and they work offline.</p>
      {state === 'checking' && <span className="row small" style={{ color: '#e9e2d8' }}><span className="spinner light" />Checking Face ID</span>}
      {state === 'failed' && (
        <form className="col" style={{ gap: 10, width: '100%' }} onSubmit={(e) => { e.preventDefault(); if (code.length === 6) { set({ walletUnlocked: true }); buzz(HAPTIC.success); } }}>
          <span className="small" style={{ color: '#e6c88f' }} role="alert">Face ID didn't match. Use your passcode.</span>
          <label htmlFor="passcode" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Passcode</label>
          <input id="passcode" className="input otp" type="password" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" />
          <button type="submit" className="btn gold block" disabled={code.length !== 6}>Unlock</button>
          <span className="tiny" style={{ color: '#b8b0a3' }}>Demo: any 6 digits</span>
        </form>
      )}
      {state === 'idle' && <button type="button" className="btn gold" onClick={tryFace}>Unlock with Face ID</button>}
    </div>
  );
}

function Unlocked() {
  const { s, set, push, toast } = useStore();
  const people = (s.household.length ? s.household : []).map((id) => PEOPLE[id]).filter(Boolean);
  const [who, setWho] = useState(people[0]?.id || 'omar');
  const [passIdx, setPassIdx] = useState(0);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, sh: 100, live: false });
  const [sheet, setSheet] = useState(null);
  const [money, setMoney] = useState(null);
  const [docOpen, setDocOpen] = useState(null);
  const [docType, setDocType] = useState('Passport');
  const p = PEOPLE[who];
  const missing = (who === 'omar' && !s.passportSaved) || p?.added;
  const issue = s.trip && s.trip.travellers.includes(who) ? passportIssue(s, who) : null;
  const showPasses = s.trip?.flight && ['daybefore', 'travelday', 'delayed', 'inair'].includes(s.phase);

  if (!people.length) return (
    <div className="screen"><div className="scroll"><div style={{ paddingTop: 54 }}><h1 className="h1">Wallet</h1></div>
      <div className="card well"><span className="h3">Add a passport and we'll keep an eye on it.</span><span className="small">Expiry dates, visas and entry rules for every trip.</span>
        <button type="button" className="btn primary small" onClick={() => set({ onboarded: false, guest: false, signinFrom: { tab: 'wallet' } })}>Sign in to add one</button></div></div></div>
  );

  const chip = missing ? { t: 'Not added yet', bg: 'rgba(233,226,216,.14)', fg: '#e9e2d8' }
    : issue?.blocking ? { t: 'Not valid for Istanbul', bg: 'rgba(217,183,122,.22)', fg: '#e6c88f' }
    : issue ? { t: `Ready · ${issue.left - 150} days to spare`, bg: 'rgba(217,183,122,.18)', fg: '#e6c88f' }
    : s.trip ? { t: 'Ready for Istanbul', bg: 'rgba(63,154,99,.22)', fg: '#9fd5b2' }
    : { t: 'Valid', bg: 'rgba(63,154,99,.22)', fg: '#9fd5b2' };

  return (
    <div className="screen">
      <div className="scroll">
        <div className="spread" style={{ paddingTop: 54 }}>
          <div className="col" style={{ gap: 2 }}>
            <h1 className="h1">Wallet</h1>
            <span className="row tiny"><Icon name="lock" size={14} />Locked with Face ID · works offline</span>
          </div>
          <button type="button" className="icon-btn dark" aria-label="Add a document" onClick={() => setSheet('add')}><Icon name="plus" color="#f6f2ec" /></button>
        </div>

        <div className="chips" role="group" aria-label="Whose documents">
          {people.map((x) => (
            <button key={x.id} type="button" className={'chip' + (who === x.id ? ' on' : '')} aria-pressed={who === x.id ? 'true' : 'false'} onClick={() => { setWho(x.id); buzz(HAPTIC.select); }}>
              <span className="dot" style={{ background: (x.id === 'omar' && !s.passportSaved) || x.added ? '#b8b0a3' : passportIssue(s, x.id) ? '#d9b77a' : '#3f9a63' }} />{x.name}
            </button>
          ))}
        </div>

        <div style={{ perspective: 1000 }}>
          <div className="passport" key={who}
            onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height; setTilt({ ry: (x - 0.5) * 14, rx: -(y - 0.5) * 10, sh: 100 - x * 100, live: true }); }}
            onPointerLeave={() => setTilt({ rx: 0, ry: 0, sh: 100, live: false })}
            style={{ transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`, transition: tilt.live ? 'transform .08s linear' : 'transform .6s var(--ease)', animation: 'rise .45s var(--ease) both' }}>
            <span className="sheen" style={{ backgroundPosition: `${tilt.sh}% 0` }} />
            <Sun width={150} color="#d9b77a" style={{ position: 'absolute', right: -18, top: 48, opacity: 0.07 }} />
            <div className="inner">
              <div className="spread">
                <span className="col" style={{ gap: 1 }}><span className="eyebrow" style={{ color: '#d9b77a', fontSize: 11 }}>Passport</span><span style={{ fontSize: 11, color: '#b8b0a3' }}>{p.helper ? 'Republic of the Philippines' : 'Kingdom of Saudi Arabia'}</span></span>
                <span className="pill" style={{ background: chip.bg, color: chip.fg }}><span className="dot" style={{ width: 6, height: 6, background: chip.fg }} />{chip.t}</span>
              </div>
              {missing ? (
                <div className="col" style={{ gap: 10 }}>
                  <span className="display" style={{ fontSize: 26, color: '#f6f2ec' }}>{who === 'omar' ? 'Your passport isn’t here yet.' : `${p.name}’s passport isn’t here yet.`}</span>
                  <button type="button" className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={() => setSheet('scan')}>Scan it now</button>
                </div>
              ) : (
                <>
                  <div className="row" style={{ gap: 14 }}>
                    <span className="photo-slot">{p.initial}</span>
                    <div className="grow col" style={{ gap: 8 }}>
                      <span className="display" style={{ fontSize: 26, color: '#f6f2ec' }}>{p.full}</span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }} className="num">
                        {[['Number', p.number], ['Born', p.born], ['Expires', issue?.blocking ? '2 Jul 2027' : p.expires]].map(([k, v]) => (
                          <span key={k} className="col" style={{ gap: 1 }}><span style={{ fontSize: 10, color: '#b8b0a3' }}>{k}</span><span style={{ fontSize: 13, fontWeight: 600, color: k === 'Expires' && issue ? '#e6c88f' : '#e9e2d8' }}>{v}</span></span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mrz">{MRZ[p.id][0]}{'\n'}{MRZ[p.id][1]}</div>
                </>
              )}
            </div>
          </div>
        </div>

        {!missing && (
          <div className="card rise">
            {s.trip ? (
              <>
                <span className="h3">{issue?.blocking ? `${who === 'omar' ? 'You' : p.name} can't travel to Istanbul on this passport.` : issue ? `Fine for Istanbul, with ${issue.left - 150} days to spare.` : s.trip.travellers.includes(who) ? 'Ready for Istanbul.' : `${p.name} isn't on the Istanbul trip.`}</span>
                {s.trip.travellers.includes(who) && <span className="small">{issue ? issue.text : 'Valid well beyond the 150 days Türkiye asks for after you land.'}</span>}
                {s.trip.travellers.includes(who) && (
                  <div style={{ position: 'relative', height: 40, margin: '0 4px' }} aria-hidden="true">
                    <span style={{ position: 'absolute', left: 0, right: 0, top: 8, height: 6, borderRadius: 999, background: '#efe9e0' }} />
                    <span style={{ position: 'absolute', left: 0, top: 8, height: 6, borderRadius: 999, width: issue?.blocking ? '78%' : '100%', background: issue?.blocking ? '#d9b77a' : issue ? 'linear-gradient(90deg,#3f9a63 80%,#d9b77a)' : '#3f9a63' }} />
                    <span style={{ position: 'absolute', left: issue ? '36%' : '14%', top: 4, width: 2, height: 14, background: '#1e352d' }} />
                    <span className="tiny" style={{ position: 'absolute', left: issue ? '36%' : '14%', top: 22, transform: 'translateX(-50%)', fontWeight: 600, color: '#1e352d', whiteSpace: 'nowrap' }}>Trip · {shortDay(s.trip.flight?.dateISO || s.trip.stay?.fromISO)}</span>
                    <span style={{ position: 'absolute', left: issue ? '95%' : '38%', top: 4, width: 2, height: 14, background: '#b98f4a' }} />
                    <span className="tiny" style={{ position: 'absolute', left: issue ? '95%' : '38%', top: 22, transform: `translateX(${issue ? -88 : -50}%)`, fontWeight: 600, color: '#7d5d27', whiteSpace: 'nowrap' }}>Needed until {shortDay(passportIssue(s, who)?.need || '') || '150 days after'}</span>
                  </div>
                )}
              </>
            ) : <><span className="h3">Valid until {p.expires}.</span><span className="small">We'll check it against every trip you plan.</span></>}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {issue?.blocking || issue
                ? <button type="button" className="btn primary small" onClick={() => {
                    set((prev) => ({ requests: [...prev.requests, { id: 'r' + Date.now(), kind: 'visa', short: 'passport renewal', title: `Passport renewal for ${p.name}`, detail: 'Before the next trip', status: s.demo.offline ? 'queued' : 'sent', created: Date.now(), quote: 150 }] }));
                    buzz(HAPTIC.success); toast(`Sent to Mada. We'll find the earliest renewal slot for ${p.name}.`);
                  }}>Book a renewal</button>
                : null}
              <button type="button" className="btn secondary small" onClick={async () => {
                try { await navigator.clipboard.writeText(p.number.replace(/\u2022/g, '')); toast('Number copied.'); } catch (e) { toast(`Number: ${p.number}`); }
              }}>Copy number</button>
            </div>
          </div>
        )}

        <span className="eyebrow">{who === 'omar' ? 'Your other documents' : `${p.name}'s other documents`}</span>
        {(() => {
          /* Only documents someone actually added. Helpers need two that we ask for by name. */
          const docs = (s.docs || []).filter((d) => d.person === who).map((d) => [d.icon || (/visa/i.test(d.type) ? 'visa' : 'doc'), d.type, d.sub, d.id, d.seeded]);
          const asks = p.helper ? [['doc', 'Iqama', 'Not added'], ['doc', 'Exit and re-entry visa', 'Needed before each trip abroad']].filter(([, t]) => !docs.some((d) => d[1] === t)) : [];
          const rows = [...docs, ...asks];
          if (!rows.length) return (
            <button type="button" className="card tap well wl-empty" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => setSheet('add')}>
              <Icon name="plus" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Nothing else yet</span><span className="tiny">Add a visa, a national ID or travel insurance. We’ll watch the dates.</span></span><Icon name="chevron" />
            </button>
          );
          return rows.map(([ic, t, sub, id, seeded]) => (
            <button key={t + (id || '')} type="button" className="card tap" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => setDocOpen({ ic, t, sub, id, seeded })}>
              <Icon name={ic} /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{t}</span><span className="tiny">{sub}</span></span><Icon name="chevron" />
            </button>
          ));
        })()}

        <span className="eyebrow">For this trip</span>
        {showPasses ? (
          <button type="button" className="card tap" onClick={() => setSheet('pass')} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AirlineMark flight={s.trip.flight} size={32} />
            <span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{s.trip.flight.code} · {s.trip.travellers.length} boarding {s.trip.travellers.length === 1 ? 'pass' : 'passes'}</span><span className="tiny">{s.trip.flight.date} · {s.trip.flight.terminal} · {s.trip.travellers.length > 1 ? 'seats' : 'seat'} {seatText(s.trip.flight.seats)}</span></span>
            <Icon name="chevron" />
          </button>
        ) : (
          <div className="card well"><span className="h3" style={{ fontSize: 15 }}>{s.trip ? 'Boarding passes' : 'Nothing booked yet'}</span><span className="tiny">{s.trip?.flight ? `For ${s.trip.flight.code} on ${s.trip.flight.date}${s.trip.flight.back ? ` and ${s.trip.flight.back} on ${s.trip.flight.backDate}` : ''}. They open at check-in, 24 hours before you fly.` : s.trip ? 'No flights on this trip.' : 'Tickets and vouchers land here as soon as they’re confirmed.'}</span></div>
        )}

        {(s.disruptionVouchers || []).length > 0 && (<>
          <span className="eyebrow">Vouchers from the airline</span>
          {s.disruptionVouchers.map((v) => (
            <div key={v.id} className="card" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name={v.kind === 'hotel' ? 'stay' : 'food'} />
              <span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{v.title}</span><span className="tiny">{v.body}</span></span>
              <span className="num tiny" style={{ fontWeight: 700, color: '#1e352d', letterSpacing: '.04em' }}>{v.code}</span>
            </div>
          ))}
        </>)}

        <span className="eyebrow">Money</span>
        <button type="button" className="credit-card" onClick={() => setMoney('credit')}>
          <span className="spread"><span className="eyebrow" style={{ color: '#d9b77a' }}>Mada credit</span><PayMark brand="credit" size={22} /></span>
          <span className="num" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-.03em' }}>SAR {(s.credit?.balance || 0).toLocaleString('en-US')}</span>
          <span className="tiny" style={{ color: '#c9c1b4' }}>{s.credit?.balance ? 'Used first at checkout. Never expires.' : 'Refunds can land here instantly instead of waiting for the bank.'}</span>
        </button>
        <button type="button" className="card tap" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => setMoney('cards')}>
          <span className="stack" style={{ display: 'flex' }}>{s.cards.slice(0, 3).map((c) => <span key={c.id} style={{ marginRight: -8 }}><PayMark brand={c.brand} size={24} /></span>)}</span>
          <span className="grow col" style={{ gap: 0, marginLeft: 8 }}><span className="h3" style={{ fontSize: 15 }}>Cards and Apple Pay</span><span className="tiny">{s.cards.length} saved · default {(s.cards.find((c) => c.id === s.defaultCard) || {}).label || 'Apple Pay'}</span></span>
          <Icon name="chevron" />
        </button>
      </div>

      {money === 'cards' && <CardsSheet current={s.defaultCard} onPick={(id) => { set({ defaultCard: id }); setMoney(null); toast(id === 'applepay' ? 'Apple Pay is your default.' : 'Default card updated.'); }} onClose={() => setMoney(null)} />}
      {money === 'credit' && (
        <Sheet label="Mada credit" onClose={() => setMoney(null)}>
          <h2 className="h2">Mada credit · SAR {(s.credit?.balance || 0).toLocaleString('en-US')}</h2>
          <p className="small">Money Mada holds for you. It comes from refunds you chose to take as credit, and it’s used first whenever you pay. It never expires, and you can move it to your card at any time.</p>
          {(s.credit?.history || []).length === 0 ? <span className="small">No movements yet.</span> : s.credit.history.map((h) => (
            <div key={h.id} className="spread" style={{ fontSize: 15 }}><span className="col" style={{ gap: 0 }}><span>{h.text}</span><span className="tiny">{new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></span><span className="num" style={{ color: h.amount > 0 ? '#2f7a4b' : '#1e352d', fontWeight: 600 }}>{h.amount > 0 ? '+' : '−'}SAR {Math.abs(h.amount).toLocaleString('en-US')}</span></div>
          ))}
          {(s.credit?.balance || 0) > 0 && s.cards.length > 0 && <button type="button" className="btn secondary block" onClick={() => { const amt = s.credit.balance; const c = s.cards.find((x) => x.id === s.defaultCard) || s.cards[0]; set((p) => ({ credit: { balance: 0, history: [{ id: 'cr' + Date.now(), text: `Moved to ${c.label}`, amount: -amt, at: Date.now() }, ...p.credit.history] } })); setMoney(null); toast(`SAR ${amt.toLocaleString('en-US')} is on its way to your ${c.label}. 5 to 10 working days.`); }}>Move it to my card</button>}
        </Sheet>
      )}
      {docOpen && (
        <Sheet label={docOpen.t} onClose={() => setDocOpen(null)}>
          <div className="row"><Icon name={docOpen.ic} /><span className="col" style={{ gap: 0 }}><span className="h2">{docOpen.t}</span><span className="tiny">{docOpen.sub}</span></span></div>
          {docOpen.sub === 'Not added' ? <button type="button" className="btn primary block" onClick={() => { setDocOpen(null); setSheet('add'); }}>Add it</button> : (<>
            <button type="button" className="card tap well" onClick={() => { setDocOpen(null); setSheet('add'); }}><span className="h3" style={{ fontSize: 15 }}>Replace with a newer one</span><span className="tiny">Scan or upload it. The old one is removed once the new one is saved.</span></button>
            <button type="button" className="card tap well" onClick={() => { setDocOpen(null); toast('Shared with Faisal for this trip only. He can’t download it.'); }}><span className="h3" style={{ fontSize: 15 }}>Share with Faisal</span><span className="tiny">For a visa or a booking. Access ends when the trip does.</span></button>
            {docOpen.id && !docOpen.seeded ? <button type="button" className="btn ghost block" style={{ color: '#8a3524' }} onClick={() => { set((p) => ({ docs: (p.docs || []).filter((d) => d.id !== docOpen.id) })); setDocOpen(null); toast('Deleted from this phone and from Mada.'); }}>Delete</button>
              : <span className="tiny">Added when you set up Mada. To remove it, message Faisal.</span>}
          </>)}
        </Sheet>
      )}

      {sheet === 'add' && (
        <Sheet label="Add a document" onClose={() => setSheet(null)}>
          <h2 className="h2">What are you adding?</h2>
          {['Passport', 'Visa', 'National ID or iqama', 'Travel insurance', 'Something else'].map((t) => (
            <button key={t} type="button" className="card tap well" onClick={() => { setDocType(t); setSheet('upload'); }}><span className="h3" style={{ fontSize: 15 }}>{t}</span></button>
          ))}
        </Sheet>
      )}
      {sheet === 'upload' && <UploadSheet title={`Add ${docType === 'Something else' ? 'a document' : docType.toLowerCase()} for ${p.name}`}
        found={docType === 'Visa' ? [['Type', 'Schengen, multiple entry'], ['Valid', '12 Jun 2026 – 11 Jun 2028'], ['Name', p.full]] : docType === 'Travel insurance' ? [['Insurer', 'Family travel cover'], ['Covers', 'Türkiye, 9–15 Mar'], ['Policy', 'TI-48211']] : docType === 'Passport' ? [['Name', p.full], ['Number', p.number], ['Expires', p.expires]] : [['Document', docType], ['Name', p.full]]}
        readPassport={docType === 'Passport'}
        onSave={(read) => { set((prev) => ({ docs: [...(prev.docs || []), { id: 'd' + Date.now(), person: who, type: docType, sub: read ? `${read.number} · expires ${read.expiry}` : docType === 'Visa' ? 'Schengen · multiple entry until Jun 2028' : docType === 'Travel insurance' ? 'Covers Türkiye, 9–15 Mar' : 'Added just now' }] })); setSheet(null); buzz(HAPTIC.success); toast('Saved to the Wallet.'); }}
        onClose={() => setSheet(null)} />}
      {sheet === 'scan' && <ScanSheet onDone={() => {
        setSheet(null);
        if (who === 'omar') set({ passportSaved: true });
        else if (p?.added) { const np = { ...p, added: false, number: `${p.id.slice(-3).toUpperCase()}•••${String(p.id).slice(-2)}`, expires: 'Valid' }; PEOPLE[p.id] = np; set((x) => ({ extraPeople: (x.extraPeople || []).map((e) => (e.id === p.id ? np : e)) })); }
        toast('Saved to the Wallet.');
      }} onClose={() => setSheet(null)} />}
      {sheet === 'pass' && (
        <Sheet label="Boarding pass" onClose={() => setSheet(null)}>
          {(() => {
            const f = s.trip.flight;
            const i = Math.min(passIdx, s.trip.travellers.length - 1);
            const pp = PEOPLE[s.trip.travellers[i]];
            return (<>
              <div className="spread"><span className="row"><AirlineMark flight={f} size={30} /><span className="col" style={{ gap: 0 }}><span className="h3">{f.code}</span><span className="tiny">{f.date} · {f.from} → {f.to}{f.cabin && f.cabin !== 'Economy' ? ' · ' + f.cabin : ''}</span></span></span><span className="pill">Seat {(f.seats || [])[i] || '—'}</span></div>
              <span className="display" style={{ fontSize: 30 }}>{pp?.full}</span>
              <div className="cells">
                <div className="cell"><span className="k">Terminal</span><span className="v">{(f.terminal || '').replace('Terminal ', '')}</span></div>
                <div className="cell"><span className="k">Gate</span><span className="v">{s.trip.gate || f.gate || 'B12'}</span></div>
                <div className="cell"><span className="k">Boards</span><span className="v">{(() => { const [h, m] = f.dep.split(':').map(Number); const t = h * 60 + m - 45; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; })()}</span></div>
              </div>
              {s.trip.travellers.length > 1 && (
                <div className="spread">
                  <button type="button" className="btn secondary small" disabled={i === 0} onClick={() => setPassIdx(i - 1)}>Previous</button>
                  <span className="tiny">{i + 1} of {s.trip.travellers.length}</span>
                  <button type="button" className="btn secondary small" disabled={i === s.trip.travellers.length - 1} onClick={() => setPassIdx(i + 1)}>Next</button>
                </div>
              )}
            </>);
          })()}
          <div style={{ alignSelf: 'center', width: 200, height: 200, display: 'grid', gridTemplateColumns: 'repeat(21, 1fr)', background: '#fff', padding: 10, boxSizing: 'content-box', borderRadius: 16 }} aria-label="Boarding pass code" role="img">
            {Array.from({ length: 441 }, (_, i) => <span key={i} style={{ background: ((i * 7919) % 13 < 6 || [0, 1, 2, 20, 19, 18, 420, 421, 422].includes(i)) ? '#0f1a16' : '#fff' }} />)}
          </div>
          <span className="small" style={{ textAlign: 'center' }}>Turn the brightness up at the gate.</span>
          <button type="button" className="btn secondary block">Add to Apple Wallet</button>
        </Sheet>
      )}
    </div>
  );
}

export function ScanSheet({ onDone, onClose }) {
  const { s } = useStore();
  const [st, setSt] = useState('scanning');
  useEffect(() => {
    if (st !== 'scanning') return undefined;
    const t = setTimeout(() => { if (s.demo.scanFails) { setSt('failed'); buzz(HAPTIC.soft); } else { setSt('ok'); buzz(HAPTIC.success); } }, 1800);
    return () => clearTimeout(t);
  }, [st]);
  return (
    <Sheet label="Scan" onClose={onClose}>
      <div className="viewfinder" style={{ margin: 0, background: '#0b100d' }}>{st === 'scanning' && <span className="scanline" />}</div>
      {st === 'scanning' && <span className="small" style={{ textAlign: 'center' }}>Hold it flat inside the frame…</span>}
      {st === 'failed' && <><span className="h3">We couldn't read it.</span><span className="small">Flat surface, no glare, the whole page in the frame.</span><button type="button" className="btn primary block" onClick={() => setSt('scanning')}>Try again</button></>}
      {st === 'ok' && <><span className="h3">Got it. Check the details?</span><span className="small">Name, number and expiry read from the page.</span><button type="button" className="btn primary block" onClick={onDone}>Save</button></>}
    </Sheet>
  );
}

const hidden = { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' };
const isExpired = (ddmmyyyy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy || ''); return !!m && new Date(+m[3], +m[2] - 1, +m[1]) < new Date(); };

/* Upload a photo or PDF: real file picker. Passports are read from the photo for real (ocr.js); other documents are simulated. */
export function UploadSheet({ title, found, onSave, onClose, allowScan = true, readPassport: realRead = false }) {
  const { s } = useStore();
  const [st, setSt] = useState('choose');
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [progress, setProgress] = useState(0);
  const [read, setRead] = useState(null); // what the passport reader found
  const run = useRef(0);
  useEffect(() => () => { run.current += 1; }, []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);

  const simulate = (ms) => setTimeout(() => { if (s.demo.scanFails) { setSt('failed'); buzz(HAPTIC.soft); } else { setSt('found'); buzz(HAPTIC.success); } }, ms);

  const readPhoto = (f) => {
    const bad = checkFile(f);
    if (bad) { setErr(bad); return; }
    const mine = ++run.current;
    setFile(f); setRead(null); setProgress(0); setPhoto(URL.createObjectURL(f)); setSt('reading');
    readPassport(f, (n) => { if (run.current === mine) setProgress(n); })
      .then((r) => {
        if (run.current !== mine) return;
        if (!r.fields) { setSt('failed'); buzz(HAPTIC.soft); return; }
        setRead(r); setSt('found'); buzz(r.doubtful.length ? HAPTIC.soft : HAPTIC.success);
      })
      .catch((e) => {
        if (run.current !== mine) return;
        setErr(/photo|open/i.test(e.message) ? e.message : 'The passport reader didn’t load. Check your connection and try again.');
        setSt('choose'); buzz(HAPTIC.soft);
      });
  };

  const pick = (f) => {
    setErr(null);
    if (!f) return;
    if (realRead && f.type === 'application/pdf') { setErr('We read passports from a photo, not a PDF. Take a photo of the photo page instead.'); return; }
    if (realRead) { readPhoto(f); return; }
    if (!/^image\/|application\/pdf/.test(f.type)) { setErr('That file type won’t work. Use a photo or a PDF.'); return; }
    if (f.size > 10 * 1024 * 1024) { setErr('That file is over 10 MB. Try a photo of the page instead.'); return; }
    setFile(f); setSt('reading');
    simulate(1600);
  };

  const rows = read ? [
    ['Surname', read.fields.surname, 'surname'],
    ['Given names', read.fields.given, 'given'],
    ['Number', read.fields.number, 'number'],
    ['Nationality', read.fields.nationality, 'nationality'],
    ['Born', read.fields.dob, 'dob'],
    ['Expires', read.fields.expiry, 'expiry'],
  ] : found.map(([k, v]) => [k, v, null]);

  return (
    <Sheet label={title} onClose={onClose}>
      <h2 className="h2">{title}</h2>
      {st === 'choose' && (
        <>
          {allowScan && (realRead ? (
            <label className="card tap well" style={{ flexDirection: 'row', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
              <Icon name="scan" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Take a photo of the photo page</span><span className="tiny">We read the two lines at the bottom</span></span>
              <input type="file" accept="image/*" capture="environment" onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ''; }} style={hidden} />
            </label>
          ) : (
            <button type="button" className="card tap well" onClick={() => { setSt('reading'); simulate(1800); }} style={{ flexDirection: 'row', alignItems: 'center' }}><Icon name="scan" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Scan with the camera</span><span className="tiny">Best for passports and printed visas</span></span></button>
          ))}
          <label className="card tap well" style={{ flexDirection: 'row', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
            <Icon name="doc" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{realRead ? 'Choose a photo' : 'Upload a photo or PDF'}</span><span className="tiny">{realRead ? 'From your photos · up to 10 MB' : 'From your files or photos · up to 10 MB'}</span></span>
            <input type="file" accept={realRead ? 'image/*' : 'image/*,application/pdf'} onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ''; }} style={hidden} />
          </label>
          {err && <span className="err" role="alert" style={{ fontSize: 13, color: '#8a3524' }}>{err}</span>}
        </>
      )}
      {st === 'reading' && (realRead && photo ? (
        <>
          <div className="viewfinder" style={{ margin: 0, height: 180, background: '#0b100d' }}>
            <img src={photo} alt="Your passport photo" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 85%', opacity: 0.9 }} />
            <span className="scanline" />
          </div>
          <div className="col" style={{ gap: 8 }} aria-live="polite">
            <span className="h3" style={{ fontSize: 15 }}>Reading your passport…</span>
            <div role="progressbar" aria-label="Reading your passport" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} style={{ height: 6, borderRadius: 999, background: '#efe9e0', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${progress}%`, background: '#1e352d', borderRadius: 999, transition: 'width .3s var(--ease)' }} />
            </div>
            <span className="tiny num">{progress < 30 ? 'Getting ready. The first scan takes a few seconds longer.' : 'Looking for the two lines at the bottom.'} {progress}%</span>
          </div>
        </>
      ) : <div className="row small"><span className="spinner" />Reading {file ? file.name : 'the page'}…</div>)}
      {st === 'failed' && (
        <>
          <span className="h3">We couldn't read it.</span>
          <span className="small">{realRead ? 'Lay it flat on a table, away from glare, with the whole photo page in the shot, including the two lines at the bottom.' : 'Try a sharper photo, flat and without glare, or a PDF straight from the issuer.'}</span>
          <button type="button" className="btn primary block" onClick={() => setSt('choose')}>Try again</button>
        </>
      )}
      {st === 'found' && (
        <>
          <span className="small">{read ? 'Read from your photo. Check every letter before saving.' : 'We found this. Check it before saving.'}</span>
          <div className="card well" style={{ gap: 6 }}>
            {rows.map(([k, v, key]) => {
              const unsure = read && read.doubtful.includes(key);
              return (
                <div key={k} className="spread small">
                  <span>{k}</span>
                  <span className="row" style={{ gap: 6 }}>
                    {unsure && <span className="pill" style={{ background: '#f3e6c9', color: '#7d5d27', height: 22, padding: '0 8px', fontSize: 11 }}>Check this</span>}
                    <span style={{ color: '#1e352d', fontWeight: 600, borderBottom: unsure ? '2px solid #d9b77a' : 'none' }}>{v || '—'}</span>
                  </span>
                </div>
              );
            })}
          </div>
          {read && isExpired(read.fields.expiry) && <span className="small" role="alert" style={{ color: '#7d5d27' }}>This passport has expired. We'll save it, but it can't be used to travel. Mada can help you renew it.</span>}
          <button type="button" className="btn primary block" onClick={() => onSave(read ? read.fields : undefined)}>Save</button>
          <button type="button" className="btn ghost block" onClick={() => { setRead(null); setSt('choose'); }}>Something's wrong</button>
        </>
      )}
    </Sheet>
  );
}
