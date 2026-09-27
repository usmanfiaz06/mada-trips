/* =========================================================
   MADA TRIPS: motion
   GSAP + ScrollTrigger + Lenis
   ========================================================= */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => innerWidth <= 820;

  gsap.registerPlugin(ScrollTrigger);
  $$('.js-year').forEach(el => (el.textContent = new Date().getFullYear()));

  /* ---------------- Smooth scroll ---------------- */
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new Lenis({ duration: 1.15, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }
  const scrollTo = target => (lenis ? lenis.scrollTo(target, { offset: 0, duration: 1.6 }) : $(target)?.scrollIntoView({ behavior: 'smooth' }));
  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id.length < 2 || !$(id)) return;
    e.preventDefault();
    document.body.classList.remove('menu-open');
    scrollTo(id);
  }));

  /* ---------------- Text splitting ---------------- */
  function splitWords(el, wrapMask) {
    const walk = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const parts = n.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          parts.forEach(p => {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span');
            w.className = 'w';
            if (wrapMask) {
              w.className = 'wm';
              const i = document.createElement('span');
              i.className = 'w-in';
              i.textContent = p;
              w.appendChild(i);
            } else w.textContent = p;
            frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(el);
  }
  $$('.split').forEach(el => splitWords(el, true));
  $$('.scrub-text').forEach(el => splitWords(el, false));

  /* ---------------- Magnetic buttons ---------------- */
  if (matchMedia('(hover: hover)').matches) {
    $$('.magnetic').forEach(el => {
      const xTo = gsap.quickTo(el, 'x', { duration: .6, ease: 'elastic.out(1, .4)' });
      const yTo = gsap.quickTo(el, 'y', { duration: .6, ease: 'elastic.out(1, .4)' });
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - r.left - r.width / 2) * .25);
        yTo((e.clientY - r.top - r.height / 2) * .35);
      });
      el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
    });

    /* 3D tilt + glow on cards */
    $$('.tilt').forEach(el => {
      const rx = gsap.quickTo(el, 'rotationX', { duration: .8, ease: 'power3' });
      const ry = gsap.quickTo(el, 'rotationY', { duration: .8, ease: 'power3' });
      gsap.set(el, { transformPerspective: 1200 });
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        ry((px - .5) * 6); rx((.5 - py) * 6);
        el.style.setProperty('--mx', px * 100 + '%');
        el.style.setProperty('--my', py * 100 + '%');
      });
      el.addEventListener('pointerleave', () => { rx(0); ry(0); });
    });
  }

  /* ---------------- Mobile menu ---------------- */
  $('.nav__burger')?.addEventListener('click', () => document.body.classList.toggle('menu-open'));

  /* ---------------- Nav state ---------------- */
  const nav = $('.nav');
  const setTheme = t => { if (nav.dataset.theme !== t) nav.dataset.theme = t; };
  /* ---------------- Hero: rotating pills + typed placeholder ---------------- */
  const pills = $$('.pill');
  let pi = 0;
  setInterval(() => { pills[pi].classList.remove('is-on'); pi = (pi + 1) % pills.length; pills[pi].classList.add('is-on'); }, 2200);

  const typeLoop = (setter, words, { type = 70, hold = 1500, erase = 35, onFull } = {}) => {
    let wi = 0, ci = 0, dir = 1;
    const tick = () => {
      const w = words[wi];
      ci += dir;
      setter(w.slice(0, ci));
      if (dir === 1 && ci >= w.length) { onFull && onFull(wi); dir = -1; return setTimeout(tick, hold); }
      if (dir === -1 && ci <= 0) { dir = 1; wi = (wi + 1) % words.length; return setTimeout(tick, 400); }
      setTimeout(tick, dir === 1 ? type : erase);
    };
    tick();
  };
  const heroInput = $('.search__input');
  typeLoop(t => heroInput.setAttribute('placeholder', 'Where to?  ' + t), ['AlUla', 'The Red Sea', 'Riyadh', 'Diriyah', 'Paris', 'NEOM', 'Abha'], { hold: 1300 });

  /* ---------------- Visa typing + stamp ---------------- */
  const visaEl = $('.js-visa-typed'), stamp = $('.js-stamp');
  typeLoop(t => (visaEl.textContent = t), ['Schengen · France', 'UK Standard Visitor', 'Umrah · 4 guests', 'Business eVisa · KSA'], {
    hold: 1900,
    onFull: () => {
      gsap.fromTo(stamp, { scale: 2.2, opacity: 0, rotate: -24 }, { scale: 1, opacity: 1, rotate: -12, duration: .45, ease: 'back.out(2.2)' });
      gsap.to(stamp, { opacity: 0, delay: 1.5, duration: .3 });
    }
  });

  /* ---------------- Ticket plane ---------------- */
  const tPlane = $('.ticket__plane');
  if (tPlane) {
    const o = { v: 0 };
    gsap.to(o, { v: 100, duration: 3.4, ease: 'power1.inOut', repeat: -1, repeatDelay: .6, onUpdate: () => (tPlane.style.offsetDistance = o.v + '%') });
  }

  /* ---------------- Chat ---------------- */
  const chat = $('.chat');
  if (chat) {
    const [inMsg, outMsg] = $$('.msg', chat);
    const typing = $('.typing', chat), text = $('.msg__text', chat);
    const chatTl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 2.5 })
      .set(text, { display: 'none' }).set(typing, { display: 'inline-flex' })
      .fromTo(inMsg, { y: 30, opacity: 0, scale: .95 }, { y: 0, opacity: 1, scale: 1, duration: .6, ease: 'back.out(1.6)' })
      .fromTo(outMsg, { y: 30, opacity: 0, scale: .95 }, { y: 0, opacity: 1, scale: 1, duration: .6, ease: 'back.out(1.6)' }, '+=.6')
      .set(typing, { display: 'none' }, '+=1.4').set(text, { display: 'inline' })
      .fromTo(text, { opacity: 0 }, { opacity: 1, duration: .3 })
      .to({}, { duration: 3 })
      .to([inMsg, outMsg], { opacity: 0, y: -10, duration: .4 });
    ScrollTrigger.create({ trigger: chat, start: 'top 85%', end: 'bottom top', onToggle: s => (s.isActive ? chatTl.play() : chatTl.pause()) });
  }

  /* ---------------- Counters ---------------- */
  $$('.count').forEach(el => {
    const to = +el.dataset.to, from = +(el.dataset.from || 0);
    const o = { v: from };
    ScrollTrigger.create({
      trigger: el, start: 'top 90%', once: true,
      onEnter: () => gsap.to(o, { v: to, duration: to > 100 ? 2.4 : 1.6, ease: 'power3.out', onUpdate: () => (el.textContent = Math.round(o.v)) })
    });
  });
  const nights = $('.js-nights');
  if (nights) {
    let n = 1;
    setInterval(() => { n = n >= 5 ? 1 : n + 1; nights.textContent = n; gsap.fromTo(nights, { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: .4 }); }, 1800);
  }
  gsap.to('.stay__float', { y: -14, rotate: 3, duration: 2.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });

  /* ---------------- Generic reveals ---------------- */
  const revealAll = () => {
    $$('.reveal-up').forEach(el => gsap.from(el, { y: 30, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } }));
    $$('.split').forEach(el => gsap.from($$('.w-in', el), {
      yPercent: 115, rotate: 4, duration: 1.1, ease: 'power4.out', stagger: .05,
      scrollTrigger: { trigger: el, start: 'top 85%' }
    }));
    $$('.scrub-text').forEach(el => gsap.to($$('.w', el), {
      opacity: 1, stagger: .1, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 45%', scrub: true }
    }));
    $$('.bento .card').forEach((el, i) => gsap.from(el, {
      y: 80, opacity: 0, scale: .96, duration: 1.2, ease: 'power3.out', delay: (i % 2) * .1,
      scrollTrigger: { trigger: el, start: 'top 90%' }
    }));
    $$('.stat').forEach((el, i) => gsap.from(el, { y: 40, opacity: 0, duration: 1, delay: i * .08, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 92%' } }));
  };

  /* ================================================================
     1. HERO → CARD (pinned, scrubbed)
     ================================================================ */
  const stage = $('.reach__stage');
  const geo = () => {
    const vw = innerWidth, vh = innerHeight;
    let w, h, x, y;
    if (isMobile()) {
      w = vw * .86; h = vh * .46; x = (vw - w) / 2; y = vh * .13;
    } else {
      w = Math.min(Math.max(vw * .25, 300), 440);
      h = Math.min(vh * .68, w * 1.45);
      x = vw * .46 - w / 2;
      y = (vh - h) / 2 + 12;
    }
    const s = Math.min(1, Math.max(h / vh, w / vw) * 1.14);
    return { vw, vh, w, h, x, y, s };
  };
  const applyGeo = () => {
    const g = geo();
    stage.style.setProperty('--cx', g.x + 'px');
    stage.style.setProperty('--cy', g.y + 'px');
    stage.style.setProperty('--cw', g.w + 'px');
    stage.style.setProperty('--ch', g.h + 'px');
  };
  applyGeo();
  ScrollTrigger.addEventListener('refreshInit', applyGeo);

  const chapterItems = $$('.chapter__item');
  const slides = $$('.frame__slide');
  const dots = $$('.chapter__progress i');
  const frameLabel = $('.js-frame-label');
  const labels = ['Arabian Dunes · 24°N', 'Red Sea Coast · Stay', 'On site · Riyadh', 'Main Stage · Live'];
  const CH_START = 1.5, CH_LEN = 1.1;

  const reachTl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '.reach', start: 'top top', end: () => '+=' + innerHeight * 4.2,
      pin: true, scrub: 1, invalidateOnRefresh: true,
      onUpdate(self) {
        const t = self.progress * reachTl.duration();
        const idx = t < CH_START ? 0 : Math.min(3, 1 + Math.floor((t - CH_START) / CH_LEN));
        dots.forEach((d, k) => {
          d.classList.toggle('is-on', k === idx);
          let p = 0;
          if (k < idx) p = 1;
          else if (k === idx) p = k === 0 ? gsap.utils.clamp(0, 1, (t - .9) / (CH_START - .9)) : gsap.utils.clamp(0, 1, (t - CH_START - (k - 1) * CH_LEN) / CH_LEN);
          d.style.setProperty('--p', p);
        });
        if (frameLabel.textContent !== labels[idx]) frameLabel.textContent = labels[idx];
      }
    }
  });

  reachTl
    .fromTo('.frame', { clipPath: () => (isMobile() ? 'inset(46px 8px 8px 8px round 22px)' : 'inset(48px 12px 12px 12px round 28px)') }, {
      clipPath: () => { const g = geo(); return `inset(${g.y}px ${g.vw - g.x - g.w}px ${g.vh - g.y - g.h}px ${g.x}px round 26px)`; },
      duration: 1, ease: 'power2.inOut'
    }, 0)
    .fromTo('.frame__media', { scale: 1 }, {
      scale: () => geo().s,
      transformOrigin: () => { const g = geo(); return `${g.x + g.w / 2}px ${g.y + g.h / 2}px`; },
      duration: 1, ease: 'power2.inOut'
    }, 0)
    .to('.frame__shade', { opacity: .2, duration: 1 }, 0)
    .to('.hero-copy', { y: -90, opacity: 0, duration: .45, ease: 'power2.in' }, 0)
    .to('.pass', { y: 60, opacity: 0, duration: .4, ease: 'power2.in' }, 0)
    .to('.scroll-hint', { opacity: 0, duration: .2 }, 0)
    .to('.topbar', { yPercent: -100, duration: .25 }, 0)
    .to('.chapter', { opacity: 1, duration: .3 }, .8)
    .fromTo(chapterItems[0], { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .4, ease: 'power3.out' }, .85)
    .fromTo('.manifesto', { xPercent: -45, opacity: 0 }, { xPercent: 0, opacity: 1, duration: .6, ease: 'power3.out' }, .95)
    .to('.frame__label', { opacity: .9, duration: .25 }, 1)
    .fromTo('.frame__chip', { opacity: 0, y: 40, rotate: -24 }, { opacity: 1, y: 0, rotate: -8, duration: .4, ease: 'back.out(2)' }, 1.05);

  for (let i = 1; i < 4; i++) {
    const at = CH_START + (i - 1) * CH_LEN;
    reachTl
      .to(chapterItems[i - 1], { y: -40, opacity: 0, duration: .35, ease: 'power2.in' }, at)
      .fromTo(chapterItems[i], { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .4, ease: 'power3.out' }, at + .3)
      .fromTo(slides[i - 1], { opacity: 0, scale: 1.18 }, { opacity: 1, scale: 1, duration: .7, ease: 'power2.out' }, at)
      .fromTo('.frame__chip', { rotate: -8 }, { rotate: i % 2 ? 6 : -8, duration: .5, ease: 'power2.inOut' }, at);
  }
  reachTl.to({}, { duration: .5 });

  /* ================================================================
     2. MARQUEE (velocity reactive)
     ================================================================ */
  const marquees = $$('.marquee').map(m => {
    const track = $('.marquee__track', m);
    m.appendChild(track.cloneNode(true));
    return { m, tracks: $$('.marquee__track', m), dir: +m.dataset.speed, x: 0, w: 0 };
  });
  const measure = () => marquees.forEach(q => (q.w = q.tracks[0].offsetWidth));
  measure(); addEventListener('resize', measure);
  document.fonts?.ready.then(measure);
  let vel = 0;
  gsap.ticker.add((time, dt) => {
    const v = lenis ? lenis.velocity : 0;
    vel += (v - vel) * .1;
    marquees.forEach(q => {
      if (!q.w) return;
      q.x -= q.dir * (0.06 * dt + Math.abs(vel) * .35) * (vel < -0.5 ? -1 : 1);
      if (q.x <= -q.w) q.x += q.w;
      if (q.x > 0) q.x -= q.w;
      q.tracks.forEach(t => (t.style.transform = `translate3d(${q.x}px,0,0) skewX(${gsap.utils.clamp(-8, 8, -vel * .4)}deg)`));
    });
  });

  /* ================================================================
     3. SERVICES horizontal
     ================================================================ */
  const mm = gsap.matchMedia();
  mm.add('(min-width: 821px)', () => {
    const track = $('.services__track');
    const dist = () => track.scrollWidth - innerWidth + 40;
    const tween = gsap.to(track, {
      x: () => -dist(), ease: 'none',
      scrollTrigger: {
        trigger: '.services', start: 'top top', end: () => '+=' + dist(), pin: '.services__pin',
        scrub: 1, invalidateOnRefresh: true
      }
    });
    gsap.to('.js-sbar', { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.services', start: 'top top', end: () => '+=' + dist(), scrub: true } });
    $$('.svc__img img').forEach(img => gsap.fromTo(img, { xPercent: -6 }, {
      xPercent: 6, ease: 'none',
      scrollTrigger: { trigger: img.closest('.svc'), containerAnimation: tween, start: 'left right', end: 'right left', scrub: true }
    }));
    $$('.svc').forEach(card => gsap.from(card, {
      rotate: 4, y: 60, opacity: .3, ease: 'power2.out',
      scrollTrigger: { trigger: card, containerAnimation: tween, start: 'left 105%', end: 'left 65%', scrub: true }
    }));
  });

  /* ================================================================
     4. PROCESS steps (pinned)
     ================================================================ */
  const steps = $$('.pstep'), vis = $$('.pvis');
  const briefEl = $('.js-brief');
  const briefText = 'Board retreat · 60 guests · AlUla · March';
  const rays = $$('.gauge__sun path'), gaugeWrap = $('.gauge'), gaugeNum = $('.js-gauge');

  gsap.set(steps[0], { opacity: 1 }); gsap.set(vis[0], { opacity: 1 });
  const procTl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '.process__panel', start: 'top top', end: () => '+=' + innerHeight * 3.2, pin: true, scrub: 1,
      onUpdate(self) {
        const t = self.progress * procTl.duration();
        const idx = Math.min(3, Math.floor(t));
        steps.forEach((s, k) => s.classList.toggle('is-on', k === idx));
        // step 1: typing
        const tp = gsap.utils.clamp(0, 1, t / .75);
        briefEl.textContent = briefText.slice(0, Math.round(tp * briefText.length));
        // step 4: gauge
        const gp = gsap.utils.clamp(0, 1, (t - 3.1) / .7);
        const lit = Math.round(gp * rays.length);
        rays.forEach((r, k) => r.classList.toggle('on', k < lit));
        gaugeWrap.classList.toggle('is-full', gp >= 1);
        gaugeNum.textContent = Math.round(gp * 100);
      }
    }
  });
  procTl.to('.ruler__dot', { top: '100%', duration: 4 }, 0);
  for (let i = 1; i < 4; i++) {
    procTl
      .to(steps[i - 1], { opacity: 0, y: -30, duration: .25, ease: 'power2.in' }, i - .15)
      .fromTo(steps[i], { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .3, ease: 'power3.out' }, i + .05)
      .to(vis[i - 1], { opacity: 0, scale: .94, filter: 'blur(8px)', duration: .3 }, i - .15)
      .fromTo(vis[i], { opacity: 0, scale: 1.06, filter: 'blur(8px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: .35 }, i + .05);
  }
  procTl.from('.plan__row', { x: 60, opacity: 0, stagger: .1, duration: .3, ease: 'power3.out' }, 1.15);
  procTl.from('.live__row', { y: 20, opacity: 0, stagger: .07, duration: .25, ease: 'power3.out' }, 2.15);
  procTl.from('.ledger__row', { y: 20, opacity: 0, stagger: .1, duration: .25, ease: 'power3.out' }, 3.3);
  procTl.to({}, { duration: .1 }, 4);

  /* ================================================================
     5. VISION
     ================================================================ */
  gsap.fromTo('.vision__mask span', { scale: 1.9, yPercent: 8 }, {
    scale: 1, yPercent: 0, ease: 'none',
    scrollTrigger: { trigger: '.vision__knock', start: 'top bottom', end: 'bottom 40%', scrub: true }
  });
  gsap.fromTo('.vision__bg', { scale: 1.35, yPercent: -6 }, {
    scale: 1, yPercent: 6, ease: 'none',
    scrollTrigger: { trigger: '.vision__stage', start: 'top bottom', end: 'bottom top', scrub: true }
  });
  gsap.from('.vision__content > *', {
    y: 60, opacity: 0, stagger: .12, duration: 1.2, ease: 'power3.out',
    scrollTrigger: { trigger: '.vision__stage', start: 'top 20%' }
  });
  gsap.fromTo('.vision__stage', { clipPath: 'inset(8% 6% 0% 6% round 30px)' }, {
    clipPath: 'inset(0% 0% 0% 0% round 30px)', ease: 'none',
    scrollTrigger: { trigger: '.vision__stage', start: 'top bottom', end: 'top 20%', scrub: true }
  });

  /* ================================================================
     6. FOUNDER
     ================================================================ */
  gsap.to('.founder__img', { scale: 1, ease: 'none', scrollTrigger: { trigger: '.founder__card', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.from('.founder__card', { y: 100, rotate: -3, opacity: 0, duration: 1.4, ease: 'power3.out', scrollTrigger: { trigger: '.founder__card', start: 'top 85%' } });
  gsap.from('.signature--dark', { clipPath: 'inset(0 100% 0 0)', duration: 1.8, ease: 'power2.inOut', scrollTrigger: { trigger: '.signature--dark', start: 'top 90%' } });

  /* ================================================================
     7. CTA sun
     ================================================================ */
  const SUN_ORIGIN = '66.16 60';
  const bigRays = $$('.cta__sun path');
  gsap.fromTo('.cta__sun', { yPercent: 40 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.cta', start: 'top bottom', end: 'center center', scrub: true } });
  gsap.to(bigRays, { scale: 1.08, svgOrigin: SUN_ORIGIN, duration: 2.4, ease: 'sine.inOut', stagger: { each: .18, yoyo: true, repeat: -1 } });
  const cta = $('.cta');
  const sunX = gsap.quickTo('.cta__sun', 'x', { duration: 1.2, ease: 'power3' });
  cta.addEventListener('pointermove', e => { const r = cta.getBoundingClientRect(); sunX(((e.clientX - r.left) / r.width - .5) * 80); });

  /* footer mega word */
  gsap.from('.footer__mega', { yPercent: 60, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true } });

  /* ================================================================
     PRELOADER → HERO INTRO
     ================================================================ */
  const loaderRays = $$('.loader .rays path');
  const counter = $('.js-count');
  const cnt = { v: 0 };
  const intro = gsap.timeline({ paused: true })
    .from('.frame__media', { scale: 1.3, duration: 2.2, ease: 'power3.out' }, 0)
    .from('.hero-title .line > span', { yPercent: 110, duration: 1.3, stagger: .12, ease: 'power4.out' }, .15)
    .from('.pills, .hero-sub, .search', { y: 30, opacity: 0, duration: 1, stagger: .1, ease: 'power3.out' }, .45)
    .from('.pass', { x: 80, opacity: 0, duration: 1.2, ease: 'power3.out' }, .6)
    .from('.nav', { y: -30, opacity: 0, duration: 1, ease: 'power3.out' }, .3)
    .from('.scroll-hint', { opacity: 0, duration: 1 }, 1);

  const finish = () => {
    document.body.classList.remove('is-loading');
    lenis?.start();
    revealAll();
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  };

  if (reduce) {
    $('.loader').remove(); finish(); intro.progress(1);
  } else {
    gsap.timeline({ onComplete: finish })
      .from(loaderRays, { scale: 0, opacity: 0, svgOrigin: SUN_ORIGIN, duration: .7, stagger: .07, ease: 'back.out(2)' })
      .from('.loader__word span', { yPercent: 120, duration: .6, stagger: .03, ease: 'power3.out' }, .3)
      .to(cnt, { v: 100, duration: 1.4, ease: 'power2.inOut', onUpdate: () => (counter.textContent = Math.round(cnt.v)) }, 0)
      .to('.loader__sun', { rotate: 0, y: -10, duration: .4 }, '>-0.1')
      .to('.loader', { clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: 'expo.inOut' })
      .add(() => intro.play(), '-=0.6')
      .set('.loader', { display: 'none' });
  }

  /* nav triggers are created last so pinned sections above are measured first */
  const onScrollNav = () => nav.classList.toggle('is-scrolled', scrollY > 40);
  addEventListener('scroll', onScrollNav, { passive: true }); onScrollNav();
  const themeOf = y => {
    const hit = document.elementsFromPoint(innerWidth / 2, y).find(el => !el.closest('.nav, .menu, .topbar'));
    return hit?.closest('[data-nav]')?.dataset.nav;
  };
  const links = $$('.nav__link');
  const sectionIds = ['#services', '#why', '#process', '#vision', '#about'];
  let navQueued = false;
  const syncNav = () => {
    navQueued = false;
    const nr = nav.getBoundingClientRect();
    const t = themeOf(nr.top + nr.height / 2);
    if (t) setTheme(t);
    const mid = document.elementsFromPoint(innerWidth / 2, innerHeight / 2).find(el => !el.closest('.nav, .menu'));
    const sec = mid?.closest('section');
    const id = sec && sectionIds.find(s => sec.matches(s));
    links.forEach(l => l.classList.toggle('is-active', !!id && l.getAttribute('href') === id));
  };
  const queueNav = () => { if (!navQueued) { navQueued = true; requestAnimationFrame(syncNav); } };
  addEventListener('scroll', queueNav, { passive: true });
  ScrollTrigger.addEventListener('refresh', queueNav);
  queueNav();

  /* pause off-screen videos */
  $$('video').forEach(v => {
    ScrollTrigger.create({
      trigger: v.closest('section'), start: 'top bottom', end: 'bottom top',
      onToggle: s => (s.isActive ? v.play().catch(() => {}) : v.pause())
    });
  });

  ScrollTrigger.sort();
  addEventListener('load', () => ScrollTrigger.refresh());
})();
