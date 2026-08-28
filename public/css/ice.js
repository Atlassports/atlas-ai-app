/* ==========================================================================
   ATLAS — ice.js

   Everything degrades to "nothing moves, page still works". Reduced motion
   short-circuits the animated paths and makes sure nothing is left hidden.
   ========================================================================== */

(function () {
  'use strict';

  var REDUCED = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function each(sel, fn, root) {
    var l = (root || document).querySelectorAll(sel);
    for (var i = 0; i < l.length; i++) fn(l[i], i);
  }
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  /* ------------------------------------------------------------- REVEALS */

  function initReveal() {
    var sel = '.rv, .wipe, .draw, .bar';
    if (REDUCED || !('IntersectionObserver' in window)) {
      each(sel, function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    each(sel, function (el) { io.observe(el); });
  }

  /* --------------------------------------------------------- MARKER LINES */

  /* Each drawn stroke needs its own length before it can draw itself on. */
  function measureStrokes() {
    each('.draw', function (svg) {
      each('path, line, circle, ellipse, polyline', function (s) {
        var len = 0;
        try { len = s.getTotalLength(); } catch (e) { len = 0; }
        if (!len) return;
        s.style.setProperty('--len', Math.ceil(len));
      }, svg);
    });
  }

  /* --------------------------------------------------------------- TILT */

  function initTilt() {
    if (REDUCED) return;
    if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return;
    each('.tilt', function (el) {
      var raf = null, tx = 0, ty = 0;
      function apply() {
        raf = null;
        el.style.setProperty('--mx', tx.toFixed(3));
        el.style.setProperty('--my', ty.toFixed(3));
      }
      el.addEventListener('pointermove', function (ev) {
        var r = el.getBoundingClientRect();
        tx = ((ev.clientX - r.left) / r.width - 0.5) * 2;
        ty = ((ev.clientY - r.top) / r.height - 0.5) * 2;
        if (!raf) raf = requestAnimationFrame(apply);
      });
      el.addEventListener('pointerleave', function () {
        tx = ty = 0;
        if (!raf) raf = requestAnimationFrame(apply);
      });
    });
  }

  /* ------------------------------------------------------------ PARALLAX */

  function initParallax() {
    var els = [].slice.call(document.querySelectorAll('[data-par]'));
    if (!els.length || REDUCED) return;
    var tick = false;
    function update() {
      tick = false;
      var vh = window.innerHeight;
      els.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -250 || r.top > vh + 250) return;
        var rate = parseFloat(el.getAttribute('data-par')) || 0;
        var mid = r.top + r.height / 2 - vh / 2;
        el.style.transform = 'translate3d(0,' + (-mid * rate).toFixed(2) + 'px,0)';
      });
    }
    function onScroll() { if (!tick) { tick = true; requestAnimationFrame(update); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* ------------------------------------------------------------ THE CHAT */

  /* Plays the sample conversation back when it scrolls into view: the coach
     "types" before each answer, and the player's questions type themselves
     into the input before they land as bubbles.

     The panel is measured and pinned to its full height first, so replaying
     it never makes the page jump. Reduced motion skips straight to the end. */
  function initChatPlayback() {
    var chat = document.querySelector('[data-chat]');
    if (!chat) return;

    var body   = chat.querySelector('[data-chat-body]');
    var field  = chat.querySelector('[data-chat-field]');
    var bubs   = [].slice.call(chat.querySelectorAll('.bub'));
    if (!body || !bubs.length) return;

    var placeholder = field ? field.getAttribute('data-placeholder') : '';

    if (REDUCED || !('IntersectionObserver' in window)) return;   // leave it shown

    // hold the space the finished conversation will occupy
    body.style.minHeight = body.getBoundingClientRect().height + 'px';
    bubs.forEach(function (b) { b.style.display = 'none'; });

    function wait(ms) {
      return new Promise(function (r) { setTimeout(r, ms); });
    }

    function typeInto(text) {
      return new Promise(function (done) {
        if (!field) return done();
        field.classList.add('live');
        var i = 0;
        (function step() {
          i++;
          field.innerHTML = text.slice(0, i).replace(/</g, '&lt;') +
                            '<span class="caret"></span>';
          if (i < text.length) setTimeout(step, 34 + Math.random() * 26);
          else setTimeout(done, 260);
        })();
      });
    }

    function resetField() {
      if (!field) return;
      field.classList.remove('live');
      field.innerHTML = placeholder;
    }

    function showTyping() {
      var t = document.createElement('div');
      t.className = 'typing';
      t.innerHTML = '<i></i><i></i><i></i>';
      body.appendChild(t);
      return t;
    }

    function reveal(b) {
      b.style.display = '';
      b.classList.add('bub-in');
    }

    async function play() {
      for (var i = 0; i < bubs.length; i++) {
        var b = bubs[i];
        if (b.getAttribute('data-from') === 'you') {
          await typeInto(b.textContent.trim());
          resetField();
          reveal(b);
          await wait(420);
        } else {
          var t = showTyping();
          await wait(1000 + Math.min(b.textContent.length * 7, 900));
          t.remove();
          reveal(b);
          await wait(520);
        }
      }
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.disconnect();
        play();
      });
    }, { threshold: 0.35 });
    io.observe(chat);
  }

  /* ------------------------------------------------------------- CLIPS */

  /* Autoplay the tab clips only while they are on screen, and never when the
     viewer has asked for reduced motion. */
  function initClips() {
    var vids = [].slice.call(document.querySelectorAll('.clip > video'));
    if (!vids.length) return;
    if (REDUCED) { vids.forEach(function (v) { v.pause(); }); return; }

    // iOS can reject an autoplay attempt made before a clip has buffered
    // enough to play -- most likely for whichever tab is open on page load,
    // since that's the one play() gets called on soonest, racing everything
    // else the page is still loading. Retry once the browser actually
    // reports it's ready, instead of giving up silently.
    function attemptPlay(v) {
      var p = v.play();
      if (p && p.catch) {
        p.catch(function () {
          v.addEventListener('canplay', function retry() {
            v.removeEventListener('canplay', retry);
            v.play().catch(function () {});
          }, { once: true });
        });
      }
    }

    // Nudge every clip to start fetching its metadata right away, not just
    // whichever one happens to be the visible tab -- a hidden clip's video
    // element doesn't start loading anything on its own until it's actually
    // laid out, which is what made switching tabs look like the fix.
    vids.forEach(function (v) {
      v.muted = true;
      if (v.readyState === 0) v.load();
    });

    if (!('IntersectionObserver' in window)) { vids.forEach(attemptPlay); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) attemptPlay(e.target);
        else e.target.pause();
      });
    }, { threshold: 0.25 });
    vids.forEach(function (v) { io.observe(v); });
  }

  /* ----------------------------------------------------------- THE SHEET */

  /* Drives the scratch drift and the travelling light pool on the ice layer. */
  function initSheet() {
    var bg = document.querySelector('.ice-bg');
    if (!bg) return;
    var root = document.documentElement, tick = false;

    function update() {
      tick = false;
      var max = (root.scrollHeight - window.innerHeight) || 1;
      root.style.setProperty('--ice-y', Math.round(window.scrollY));
      root.style.setProperty('--ice-p', clamp(window.scrollY / max, 0, 1).toFixed(4));
    }
    if (REDUCED) { update(); return; }
    window.addEventListener('scroll', function () {
      if (!tick) { tick = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  /* ---------------------------------------------------------------- TABS */

  /* Report tabs. The panels all stay in the DOM; only visibility changes,
     and the bars inside a newly shown panel re-run their fill. */
  function initTabs() {
    each('[data-tabs]', function (group) {
      var btns   = group.querySelectorAll('[data-tab]');
      var panels = group.querySelectorAll('[data-panel]');

      function show(name) {
        for (var i = 0; i < btns.length; i++) {
          btns[i].classList.toggle('on', btns[i].getAttribute('data-tab') === name);
          btns[i].setAttribute('aria-selected', btns[i].getAttribute('data-tab') === name);
        }
        for (var j = 0; j < panels.length; j++) {
          var on = panels[j].getAttribute('data-panel') === name;
          panels[j].classList.toggle('on', on);
          if (on && !REDUCED) {
            // replay the bar fills so switching tabs feels like a fresh read
            each('.bar', function (b) {
              b.classList.remove('in');
              void b.offsetWidth;
              b.classList.add('in');
            }, panels[j]);
          }
        }
      }

      for (var k = 0; k < btns.length; k++) {
        (function (b) {
          b.addEventListener('click', function () { show(b.getAttribute('data-tab')); });
        })(btns[k]);
      }
    });
  }

  /* ----------------------------------------------------------- THE RAIL */

  /* The puck follows an actual play: it banks off the boards, cycles low,
     and drives the net at the bottom of the page. Position comes from
     sampling the SVG path, so the puck goes exactly where the line goes. */
  function initRail() {
    var rail = document.getElementById('rail');
    if (!rail) return;

    var path   = document.getElementById('playPath');
    var trail  = document.getElementById('playTrail');
    var puck   = document.getElementById('puck');
    var nameEl = document.getElementById('railName');
    var metaEl = document.getElementById('railMeta');
    var clockEl= document.getElementById('railClock');
    var shiftEl= document.getElementById('railShift');
    if (!path || !puck) return;

    var LEN = path.getTotalLength();
    if (trail) {
      trail.style.strokeDasharray = LEN + ' ' + LEN;
      trail.style.strokeDashoffset = LEN;
    }

    var sections = [].slice.call(document.querySelectorAll('[data-rail-name]'));
    var lastIdx = -1, scored = false, tick = false;

    function update() {
      tick = false;
      var doc = document.documentElement;
      var max = (doc.scrollHeight - window.innerHeight) || 1;
      var p = clamp(window.scrollY / max, 0, 1);

      // --- puck rides the play line ---
      var pt = path.getPointAtLength(LEN * p);
      puck.setAttribute('transform',
        'translate(' + pt.x.toFixed(2) + ',' + pt.y.toFixed(2) + ') rotate(' + (p * 540).toFixed(1) + ')');
      if (trail) trail.style.strokeDashoffset = (LEN * (1 - p)).toFixed(1);

      // --- the lamp goes on when the puck reaches the net ---
      var isIn = p > 0.985;
      if (isIn !== scored) {
        scored = isIn;
        rail.classList.toggle('scored', isIn);
      }

      // --- clock reads out progress as a period winding down ---
      if (clockEl) {
        var left = (1 - p) * 20 * 60;
        var m = Math.floor(left / 60), s = Math.floor(left % 60);
        clockEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      }

      // --- which section is under the crosshair ---
      if (sections.length) {
        var mid = window.innerHeight * 0.4, idx = 0;
        for (var i = 0; i < sections.length; i++) {
          if (sections[i].getBoundingClientRect().top <= mid) idx = i;
        }
        if (idx !== lastIdx) {
          lastIdx = idx;
          var sec = sections[idx];
          if (nameEl) nameEl.textContent = sec.getAttribute('data-rail-name') || '';
          if (metaEl) metaEl.textContent = sec.getAttribute('data-rail-meta') || '';
          if (shiftEl) shiftEl.textContent =
            ('0' + (idx + 1)).slice(-2) + ' / ' + ('0' + sections.length).slice(-2);
        }
      }
    }

    function onScroll() { if (!tick) { tick = true; requestAnimationFrame(update); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* --------------------------------------------------------------- NAV */

  function initNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var tick = false;
    function update() { tick = false; nav.classList.toggle('stuck', window.scrollY > 20); }
    window.addEventListener('scroll', function () {
      if (!tick) { tick = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* --------------------------------------------------------------- BOOT */

  function boot() {
    measureStrokes();   // must run before reveals, so lengths exist to animate
    initReveal();
    initTilt();
    initParallax();
    initSheet();
    initChatPlayback();
    initClips();
    initTabs();
    initRail();
    initNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }

  window.AtlasIce = { reducedMotion: REDUCED, refresh: boot };
})();
