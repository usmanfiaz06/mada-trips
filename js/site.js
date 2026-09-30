/* =========================================================
   MADA TRIPS: shared site behaviour (every page)
   GSAP + ScrollTrigger + Lenis
   ========================================================= */
window.MADA = (() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hover = matchMedia('(hover: hover)').matches;
  const isMobile = () => innerWidth <= 820;
  const isHome = !!$('.reach');

  gsap.registerPlugin(ScrollTrigger);
  $$('.js-year').forEach(el => (el.textContent = new Date().getFullYear()));

  /* ---------------- Smooth scroll ---------------- */
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new Lenis({ duration: 1.15, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    if (document.body.classList.contains('is-loading')) lenis.stop();
  }
  const scrollTo = target => (lenis ? lenis.scrollTo(target, { offset: 0, duration: 1.6 }) : $(target)?.scrollIntoView({ behavior: 'smooth' }));

  // in-page anchors, including "/#section" links while already on the home page
  $$('a[href*="#"]').forEach(a => a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    const [path, hash] = href.split('#');
    if (!hash) return;
    const samePage = path === '' || (isHome && ['/', '/index.html', '/ar', '/ar/', '/ar/index.html'].includes(path));
    if (!samePage || !$('#' + hash)) return;
    e.preventDefault();
    document.body.classList.remove('menu-open');
    scrollTo('#' + hash);
  }));
  // arriving with a hash from another page
  const initialHash = location.hash && $(location.hash) ? location.hash : null;

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
            if (wrapMask) {
              w.className = 'wm';
              const i = document.createElement('span');
              i.className = 'w-in';
              i.textContent = p;
              w.appendChild(i);
            } else { w.className = 'w'; w.textContent = p; }
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

  /* ---------------- Magnetic buttons + tilt ---------------- */
  if (hover) {
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

  /* ---------------- Hover preview lists (image follows pointer) ---------------- */
  $$('.hover-list').forEach(list => {
    const box = document.createElement('div');
    box.className = 'hover-preview';
    const imgs = $$('[data-img]', list).map(row => {
      const im = new Image(); im.src = row.dataset.img; im.alt = ''; im.loading = 'lazy';
      box.appendChild(im); return im;
    });
    list.appendChild(box);
    if (!hover) return;
    const xTo = gsap.quickTo(box, 'x', { duration: .6, ease: 'power3' });
    const yTo = gsap.quickTo(box, 'y', { duration: .6, ease: 'power3' });
    const rTo = gsap.quickTo(box, 'rotation', { duration: .8, ease: 'power3' });
    let lastX = 0;
    list.addEventListener('pointermove', e => {
      const r = list.getBoundingClientRect();
      xTo(e.clientX - r.left); yTo(e.clientY - r.top);
      rTo(gsap.utils.clamp(-10, 10, (e.clientX - lastX) * .6)); lastX = e.clientX;
    });
    $$('[data-img]', list).forEach((row, i) => {
      row.addEventListener('pointerenter', () => { box.classList.add('is-on'); imgs.forEach((im, k) => im.classList.toggle('is-on', k === i)); });
    });
    list.addEventListener('pointerleave', () => box.classList.remove('is-on'));
  });

  /* ---------------- Mobile menu ---------------- */
  $('.nav__burger')?.addEventListener('click', () => document.body.classList.toggle('menu-open'));
  $$('.menu a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('menu-open')));

  /* ---------------- Typing helper ---------------- */
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

  /* ---------------- Counters ---------------- */
  $$('.count').forEach(el => {
    const to = +el.dataset.to, from = +(el.dataset.from || 0);
    const o = { v: from };
    ScrollTrigger.create({
      trigger: el, start: 'top 90%', once: true,
      onEnter: () => gsap.to(o, { v: to, duration: to > 100 ? 2.4 : 1.6, ease: 'power3.out', onUpdate: () => (el.textContent = Math.round(o.v)) })
    });
  });

  /* ---------------- Marquees (velocity reactive) ---------------- */
  const marquees = $$('.marquee').map(m => {
    const track = $('.marquee__track', m);
    m.appendChild(track.cloneNode(true));
    return { tracks: $$('.marquee__track', m), dir: +(m.dataset.speed || 1), x: 0, w: 0 };
  });
  if (marquees.length) {
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
  }

  /* ---------------- Shared sections (only if present) ---------------- */
  if ($('.vision__knock')) gsap.fromTo('.vision__mask span', { scale: 1.9, yPercent: 8 }, {
    scale: 1, yPercent: 0, ease: 'none',
    scrollTrigger: { trigger: '.vision__knock', start: 'top bottom', end: 'bottom 40%', scrub: true }
  });
  if ($('.vision__stage')) {
    gsap.fromTo('.vision__bg', { scale: 1.35, yPercent: -6 }, { scale: 1, yPercent: 6, ease: 'none', scrollTrigger: { trigger: '.vision__stage', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from('.vision__content > *', { y: 60, opacity: 0, stagger: .12, duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: '.vision__stage', start: 'top 20%' } });
    gsap.fromTo('.vision__stage', { clipPath: 'inset(8% 6% 0% 6% round 30px)' }, { clipPath: 'inset(0% 0% 0% 0% round 30px)', ease: 'none', scrollTrigger: { trigger: '.vision__stage', start: 'top bottom', end: 'top 20%', scrub: true } });
  }
  if ($('.founder__card')) {
    gsap.to('.founder__img', { scale: 1, ease: 'none', scrollTrigger: { trigger: '.founder__card', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from('.founder__card', { y: 100, rotate: -3, opacity: 0, duration: 1.4, ease: 'power3.out', scrollTrigger: { trigger: '.founder__card', start: 'top 85%' } });
    gsap.from('.signature--dark', { clipPath: 'inset(0 100% 0 0)', duration: 1.8, ease: 'power2.inOut', scrollTrigger: { trigger: '.signature--dark', start: 'top 90%' } });
  }
  const SUN_ORIGIN = '66.16 60';
  const cta = $('.cta');
  if (cta && $('.cta__sun')) {
    gsap.fromTo('.cta__sun', { yPercent: 40 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: cta, start: 'top bottom', end: 'center center', scrub: true } });
    gsap.to($$('.cta__sun path'), { scale: 1.08, svgOrigin: SUN_ORIGIN, duration: 2.4, ease: 'sine.inOut', stagger: { each: .18, yoyo: true, repeat: -1 } });
    const sunX = gsap.quickTo('.cta__sun', 'x', { duration: 1.2, ease: 'power3' });
    cta.addEventListener('pointermove', e => { const r = cta.getBoundingClientRect(); sunX(((e.clientX - r.left) / r.width - .5) * 80); });
  }
  if ($('.footer__mega')) gsap.from('.footer__mega', { yPercent: 60, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true } });

  /* ---------------- Enquiry forms ---------------- */
  const topic = new URLSearchParams(location.search).get('topic');
  if (topic) $$(`input[name="need"][value="${CSS.escape(topic)}"]`).forEach(i => (i.checked = true));
  // every enquiry is recorded in Mada Ops (/adminwork → Leads). If that fails the
  // visitor gets the same enquiry ready to send on WhatsApp, so nothing is lost.
  const AR = document.documentElement.lang === 'ar';
  const FT = AR
    ? { need: 'اختر خدمة واحدة على الأقل.', phone: 'أدخل رقم جوال صحيح، مثل 05X XXX XXXX.', sending: 'جارٍ الإرسال', fail: 'تعذّر الإرسال الآن. أرسل طلبك عبر واتساب وسيصلنا فوراً:', wa: 'إرسال عبر واتساب', hello: 'مرحباً مادا تربس،' }
    : { need: 'Pick at least one service.', phone: 'Enter a valid phone number, like 05X XXX XXXX.', sending: 'Sending', fail: 'We couldn’t send that just now. Send it on WhatsApp instead and it reaches us straight away:', wa: 'Send on WhatsApp', hello: 'Hello Mada Trips,' };
  const phoneOk = v => { const d = v.replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, ''); return d.length >= 8 && d.length <= 15; };
  $$('form.js-enquiry').forEach(f => {
    const needs = $$('input[name="need"]', f), phone = $('input[name="phone"]', f), btn = $('button[type="submit"]', f);
    const err = document.createElement('p'); err.className = 'form-err'; err.setAttribute('role', 'alert'); err.hidden = true;
    (btn.closest('.cta__fields') || btn).insertAdjacentElement('afterend', err);
    const check = () => {
      if (phone) phone.setCustomValidity(!phone.value.trim() || phoneOk(phone.value) ? '' : FT.phone);
    };
    const needBox = needs.length && needs[0].closest('[role="group"]');
    needs.forEach(i => i.addEventListener('change', () => { if (needs.some(x => x.checked)) { needBox.classList.remove('is-missing'); if (err.dataset.kind === 'need') err.hidden = true; } }));
    if (phone) phone.addEventListener('input', check);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      check();
      if (needs.length && !needs.some(i => i.checked)) {
        err.textContent = FT.need; err.dataset.kind = 'need'; err.hidden = false;
        needBox.classList.remove('is-missing'); void needBox.offsetWidth; needBox.classList.add('is-missing');
        return;
      }
      if (!f.reportValidity()) return;
      const d = new FormData(f), v = k => String(d.get(k) || '').trim();
      const details = {};
      [['company', 'Company'], ['date', 'Date'], ['size', 'Guests or team size']].forEach(([k, label]) => { if (v(k)) details[label] = v(k); });
      const lead = { source: 'form', name: v('name'), email: v('email'), phone: v('phone'), services: d.getAll('need').map(String), details, message: v('message'), lang: AR ? 'ar' : 'en', page: location.pathname, website: v('website') };
      btn.disabled = true; f.classList.add('is-sending'); err.hidden = true;
      let ok = false;
      try { const r = await fetch('/adminwork/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead) }); ok = r.ok; } catch (_) {}
      btn.disabled = false; f.classList.remove('is-sending');
      if (ok) { f.classList.add('is-sent'); return; }
      const text = [FT.hello, '', lead.services.join(', '), ...Object.entries(details).map(([k, x]) => `${k}: ${x}`), lead.message, '', lead.name, lead.email, lead.phone].filter((x, i, a) => x || (i && a[i - 1])).join('\n');
      err.dataset.kind = 'fail';
      err.innerHTML = `${FT.fail} <a href="https://wa.me/966566682662?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${FT.wa} ↗</a>`;
      err.hidden = false;
    });
  });

  /* ---------------- Reveals ---------------- */
  const revealAll = () => {
    $$('.reveal-up').forEach(el => gsap.from(el, { y: 30, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } }));
    $$('.reveal-stagger').forEach(el => gsap.from(el.children, { y: 50, opacity: 0, duration: 1, stagger: .08, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 85%' } }));
    $$('.reveal-img').forEach(el => gsap.fromTo(el, { clipPath: 'inset(12% 8% 12% 8% round 28px)' }, { clipPath: 'inset(0% 0% 0% 0% round 28px)', ease: 'none', scrollTrigger: { trigger: el, start: 'top 95%', end: 'top 40%', scrub: true } }));
    $$('.parallax-img').forEach(img => gsap.fromTo(img, { yPercent: -8, scale: 1.15 }, { yPercent: 8, ease: 'none', scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } }));
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

  /* ---------------- Nav: scrolled state, theme, active link ---------------- */
  const nav = $('.nav');
  const setTheme = t => { if (nav.dataset.theme !== t) nav.dataset.theme = t; };
  const onScrollNav = () => nav.classList.toggle('is-scrolled', scrollY > 40);
  addEventListener('scroll', onScrollNav, { passive: true }); onScrollNav();

  const here = location.pathname.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const links = $$('.nav__link');
  links.forEach(l => {
    const p = (l.getAttribute('href') || '').split('#')[0].replace(/\.html$/, '').replace(/\/$/, '') || '/';
    if (p !== '/' && p === here) { l.classList.add('is-current'); l.setAttribute('aria-current', 'page'); }
  });
  const themeOf = y => {
    const hit = document.elementsFromPoint(innerWidth / 2, y).find(el => !el.closest('.nav, .menu, .topbar'));
    return hit?.closest('[data-nav]')?.dataset.nav;
  };
  let navQueued = false;
  const syncNav = () => {
    navQueued = false;
    const nr = nav.getBoundingClientRect();
    const t = themeOf(nr.top + nr.height / 2);
    if (t) setTheme(t);
    if (!isHome) return;
    const mid = document.elementsFromPoint(innerWidth / 2, innerHeight / 2).find(el => !el.closest('.nav, .menu'));
    const sec = mid?.closest('section[id]');
    links.forEach(l => l.classList.toggle('is-active', !!sec && l.dataset.section === '#' + sec.id));
  };
  const queueNav = () => { if (!navQueued) { navQueued = true; requestAnimationFrame(syncNav); } };
  addEventListener('scroll', queueNav, { passive: true });
  ScrollTrigger.addEventListener('refresh', queueNav);
  queueNav();

  /* ---------------- Pause off-screen videos ---------------- */
  $$('video').forEach(v => {
    ScrollTrigger.create({
      trigger: v.closest('section') || v, start: 'top bottom', end: 'bottom top',
      onToggle: s => (s.isActive ? v.play().catch(() => {}) : v.pause())
    });
  });

  /* ---------------- Start ---------------- */
  let started = false;
  const start = () => {
    if (started) return; started = true;
    document.body.classList.remove('is-loading');
    lenis?.start();
    revealAll();
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
    if (initialHash) {
      // wait for pins and images to settle, then land exactly on the section
      const jump = () => { const y = $(initialHash).getBoundingClientRect().top + scrollY; lenis ? lenis.scrollTo(y, { immediate: true, force: true }) : scrollTo(0, y); };
      const settle = () => { ScrollTrigger.refresh(); setTimeout(jump, 50); setTimeout(jump, 600); };
      document.readyState === 'complete' ? settle() : addEventListener('load', settle, { once: true });
    }
  };
  // inner pages start right after their own page scripts have run
  if (!document.body.classList.contains('is-loading')) requestAnimationFrame(() => {
    const hero = $('.page-hero');
    if (hero && !reduce) gsap.from($$('[data-intro]', hero), { y: 40, opacity: 0, duration: 1.1, stagger: .08, ease: 'power3.out', delay: .05 });
    start();
  });
  addEventListener('load', () => ScrollTrigger.refresh());

  return { $, $$, reduce, hover, isMobile, lenis, typeLoop, start, SUN_ORIGIN, splitWords };
})();
