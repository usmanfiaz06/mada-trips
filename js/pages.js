/* =========================================================
   MADA TRIPS: inner page motion (events, services, about, contact)
   ========================================================= */
(() => {
  const { $, $$, reduce } = window.MADA;
  const AR = document.documentElement.lang === 'ar';

  /* ---------------- Events hero ---------------- */
  const evHero = $('.evp-hero');
  if (evHero) {
    gsap.to('.evp-hero__media', { scale: 1.15, yPercent: 8, ease: 'none', scrollTrigger: { trigger: evHero, start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.evp-hero__inner', { y: -80, opacity: 0, ease: 'none', scrollTrigger: { trigger: evHero, start: 'center center', end: 'bottom top', scrub: true } });
    if (!reduce) gsap.from('.evp-hero [data-intro]', { y: 60, opacity: 0, duration: 1.3, stagger: .1, ease: 'power4.out', delay: .1 });
  }

  /* ---------------- Run of show (loops while visible) ---------------- */
  const ros = $$('.ros__row');
  if (ros.length) {
    let i = 0, timer = null;
    const tick = () => {
      ros.forEach((r, k) => { r.classList.toggle('is-done', k < i); r.classList.toggle('is-live', k === i); });
      i = (i + 1) % ros.length;
    };
    ScrollTrigger.create({
      trigger: '.ros', start: 'top 90%', end: 'bottom top',
      onToggle: s => { clearInterval(timer); if (s.isActive) { tick(); timer = setInterval(tick, 1600); } }
    });
  }

  /* ---------------- Event flow: horizontal on desktop ---------------- */
  if ($('.flow__track')) {
    gsap.matchMedia().add('(min-width: 821px)', () => {
      const track = $('.flow__track');
      const dist = () => track.scrollWidth - innerWidth + 40;
      gsap.to(track, { x: () => (AR ? dist() : -dist()), ease: 'none', scrollTrigger: { trigger: '.evp-flow', start: 'top top', end: () => '+=' + dist(), pin: '.flow__pin', scrub: 1, invalidateOnRefresh: true } });
      gsap.to('.flow__line i', { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.evp-flow', start: 'top top', end: () => '+=' + dist(), scrub: true } });
    });
  }

  /* ---------------- Gallery rows drift with scroll ---------------- */
  $$('.gal-row').forEach((row, k) => {
    const dir = k % 2 ? 1 : -1;
    gsap.fromTo(row, { xPercent: dir < 0 ? 0 : -25 }, { xPercent: dir < 0 ? -25 : 0, ease: 'none', scrollTrigger: { trigger: '.evp-gallery', start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  /* ---------------- Capability cards ---------------- */
  $$('.caps .cap').forEach((c, i) => gsap.from(c, { y: 80, opacity: 0, scale: .96, duration: 1.2, delay: (i % 2) * .1, ease: 'power3.out', scrollTrigger: { trigger: c, start: 'top 90%' } }));

  /* ---------------- Services: table of contents ---------------- */
  const toc = $$('.svcp-toc a');
  if (toc.length) {
    $$('.svc-block').forEach(b => ScrollTrigger.create({
      trigger: b, start: 'top 50%', end: 'bottom 50%',
      onToggle: s => s.isActive && toc.forEach(a => a.classList.toggle('is-on', a.getAttribute('href') === '#' + b.id))
    }));
    $$('.svc-block').forEach(b => gsap.from(b, { y: 70, opacity: 0, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: b, start: 'top 88%' } }));
  }

  /* ---------------- Manpower: find a role ----------------
     Matches the visible name and the English name (data-en), so either
     language works on either page. Arabic letters are normalised. */
  const find = $('.js-role-find');
  if (find) {
    const fold = t => String(t).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '').trim();
    const roles = $$('.mp-roles li'), groups = $$('.mp-group'), none = $('.mp-none');
    roles.forEach(li => (li._k = fold(li.textContent + ' ' + (li.dataset.en || ''))));
    const run = () => {
      const q = fold(find.value);
      let hits = 0;
      roles.forEach(li => { const on = !q || li._k.includes(q); li.classList.toggle('is-hit', !!q && on); li.classList.toggle('is-out', !on); if (on && q) hits++; });
      groups.forEach(g => g.classList.toggle('is-out', !!q && !g.querySelector('.is-hit')));
      none.hidden = !q || hits > 0;
    };
    find.addEventListener('input', run);
  }

  /* ---------------- About: sun turns with scroll ---------------- */
  if ($('.ab-hero__sun')) gsap.to('.ab-hero__sun', { rotate: 30, yPercent: 20, ease: 'none', scrollTrigger: { trigger: '.ab-hero', start: 'top top', end: 'bottom top', scrub: true } });
  $$('.value').forEach((v, i) => gsap.from(v, { y: 60, opacity: 0, duration: 1.1, delay: i * .1, ease: 'power3.out', scrollTrigger: { trigger: v, start: 'top 90%' } }));
})();
