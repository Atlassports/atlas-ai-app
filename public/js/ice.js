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

  /* ---------------------------------------------------- CLIPS AS PICTURES */

  /* Paints a clip's frames into a <canvas> and reveals it with a wipe. The
     <video> stays in the DOM purely as a frame source, covered by an opaque
     backdrop rather than made transparent (see .clip.canvas-on::after -- iOS
     will not autoplay a clip it considers invisible), so nothing the viewer
     sees is a video element -- which is the whole point: the re-fit we were
     chasing is something browsers do to video layers, and a canvas is not one.

     Everything here is additive and reversible: the canvas is only allowed to
     take over once it has actually painted a frame, and if that never happens
     the canvas is torn down and the plain <video> is left visible. */
  function paintClip(v) {
    var clip = v.parentNode;
    if (!clip || !window.requestAnimationFrame) return;

    var cv = document.createElement('canvas');
    var ctx = null;
    try { ctx = cv.getContext('2d', { alpha: false }); } catch (e) { ctx = null; }
    if (!ctx) return;

    cv.setAttribute('aria-hidden', 'true');
    clip.insertBefore(cv, v.nextSibling);
    clip.classList.add('canvas-on');

    var painted = false;

    function fit() {
      var r = clip.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(r.width * dpr));
      var h = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    }

    function paint() {
      if (!v.videoWidth || !v.videoHeight) return;
      if (!clip.offsetParent && clip.offsetHeight === 0) return;   // panel hidden
      fit();
      // cover-fit, computed here rather than left to object-fit
      var s = Math.max(cv.width / v.videoWidth, cv.height / v.videoHeight);
      var dw = v.videoWidth * s, dh = v.videoHeight * s;
      ctx.drawImage(v, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
      if (!painted) { painted = true; revealClip(clip); }
    }

    // Paint whenever a frame becomes available, not only while playing. If
    // autoplay is refused -- iOS routinely refuses until the page has had a
    // real tap -- requestVideoFrameCallback never fires, and without this the
    // canvas would sit empty. A blocked clip should look like a still frame
    // of the footage, which is what the plain <video> used to show.
    ['loadeddata', 'canplay', 'seeked', 'play', 'playing'].forEach(function (ev) {
      v.addEventListener(ev, paint);
    });
    if (v.readyState >= 2) paint();

    // Exposed so a tab switch can force a repaint: a clip that was in a
    // hidden panel painted nothing while it was away, and if its playback is
    // blocked no event will fire to prompt one when it appears.
    v.__paintFrame = paint;

    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(function loop() {
        paint();
        v.requestVideoFrameCallback(loop);
      });
    } else {
      (function raf() { paint(); requestAnimationFrame(raf); })();
    }

    // Nothing painted -- no frames, no decode, file missing. Hand the page
    // back to the plain <video> rather than leaving an empty box. A clip in
    // a hidden tab is NOT that case: display:none means it was never asked
    // to paint, so keep waiting instead of tearing its canvas down before
    // the viewer has even opened that tab.
    var strikes = 0;
    (function watch() {
      setTimeout(function () {
        if (painted) return;
        // Only count time the clip was actually on screen and still blank. A
        // tab that has just been opened needs a moment to start decoding, and
        // a tab that is closed is not failing at all.
        strikes = clip.offsetHeight === 0 ? 0 : strikes + 1;
        if (strikes < 4) { watch(); return; }
        clip.classList.remove('canvas-on');
        if (cv.parentNode) cv.parentNode.removeChild(cv);
      }, 1000);
    })();

    window.addEventListener('resize', function () { if (painted) paint(); }, { passive: true });
  }

  /* Wipes the canvas open. Re-run on tab switch so each clip arrives the
     same way rather than only the one that happened to load first. */
  function revealClip(clip) {
    clip.classList.remove('shown', 'sweeping');
    void clip.offsetWidth;                       // restart the animation
    requestAnimationFrame(function () {
      clip.classList.add('shown');
      if (!REDUCED) clip.classList.add('sweeping');
    });
  }

  /* Autoplay the tab clips only while they are on screen, and never when the
     viewer has asked for reduced motion. */
  function initClips() {
    var vids = [].slice.call(document.querySelectorAll('.clip > video'));
    if (!vids.length) return;

    vids.forEach(paintClip);

    if (REDUCED) { vids.forEach(function (v) { v.pause(); }); return; }

    // iOS can reject an autoplay attempt made before a clip has buffered
    // enough to play -- most likely for whichever tab is open on page load,
    // since that's the one play() gets called on soonest, racing everything
    // else the page is still loading. Retry once the browser actually
    // reports it's ready, instead of giving up silently.
    // One tap anywhere starts every clip, not just the one tapped: iOS gates
    // the whole page on a single gesture, so the others would otherwise stay
    // stopped until each was tapped in turn.
    function playAll() {
      vids.forEach(function (o) {
        var q = o.play();
        if (q && q.catch) q.catch(function () {});
      });
    }

    function addPlayButton(v) {
      var clip = v.parentNode;
      if (!clip) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'clip-play';
      btn.setAttribute('aria-label', 'Play clip');
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"' +
                      ' aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        playAll();
      });
      clip.appendChild(btn);

      // The button is only ever offered while a clip is genuinely stuck: it
      // goes the moment playback starts, and never appears for a clip that
      // was deliberately paused for being scrolled off screen.
      v.addEventListener('playing', function () { clip.classList.remove('needs-play'); });
      v.addEventListener('error',   function () { clip.classList.remove('needs-play'); });
    }

    function offerPlay(v) {
      if (v.parentNode) v.parentNode.classList.add('needs-play');
    }

    function attemptPlay(v) {
      var p = v.play();
      if (p && p.catch) {
        p.catch(function () {
          offerPlay(v);                       // refused: give the viewer a tap
          v.addEventListener('canplay', function retry() {
            v.removeEventListener('canplay', retry);
            v.play().catch(function () { offerPlay(v); });
          }, { once: true });
        });
      }
      // play() can resolve while playback never actually begins; check back.
      setTimeout(function () { if (v.paused) offerPlay(v); }, 1200);
    }

    // Nudge every clip to start fetching its metadata right away, not just
    // whichever one happens to be the visible tab -- a hidden clip's video
    // element doesn't start loading anything on its own until it's actually
    // laid out, which is what made switching tabs look like the fix.
    vids.forEach(function (v) {
      v.muted = true;
      addPlayButton(v);
      if (v.readyState === 0) v.load();
    });

    if (!('IntersectionObserver' in window)) { vids.forEach(attemptPlay); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          attemptPlay(e.target);
        } else {
          e.target.pause();
          if (e.target.parentNode) e.target.parentNode.classList.remove('needs-play');
        }
      });
    }, { threshold: 0.25 });
    vids.forEach(function (v) { io.observe(v); });

    // Separately, iOS can refuse to autoplay ANY video -- even muted --
    // until the page has registered a real user gesture, no matter how
    // ready the clip's data is. Retrying on canplay never clears that; only
    // an actual tap does. The catch: not every touch qualifies -- a touch
    // that turns into a scroll (the likeliest way anyone actually reaches
    // this section) doesn't reliably count, so a single one-shot attempt
    // can use itself up on a scroll and never fire again for the tap that
    // follows. Keep retrying on every touch/click, wherever it lands, until
    // nothing on screen is still paused.
    function unlockOnGesture() {
      var anyPaused = false;
      vids.forEach(function (v) {
        var r = v.getBoundingClientRect();
        var vh = window.innerHeight || document.documentElement.clientHeight;
        if (r.bottom <= 0 || r.top >= vh) return;
        if (v.paused) { attemptPlay(v); anyPaused = true; }
      });
      if (!anyPaused) {
        ['touchstart', 'pointerdown', 'click'].forEach(function (evt) {
          document.removeEventListener(evt, unlockOnGesture);
        });
      }
    }
    ['touchstart', 'pointerdown', 'click'].forEach(function (evt) {
      document.addEventListener(evt, unlockOnGesture, { passive: true });
    });
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

          // A hidden panel is display:none, so its clip never painted while
          // it was away. Start it again and wipe it in, so every tab arrives
          // the same way instead of only the first one.
          if (on) {
            var tv = panels[j].querySelector('.clip > video');
            if (tv) {
              if (!REDUCED && tv.paused) { var pr = tv.play(); if (pr && pr.catch) pr.catch(function () {}); }
              var tc = tv.parentNode;
              if (typeof tv.__paintFrame === 'function') tv.__paintFrame();
              if (tc && tc.classList.contains('canvas-on')) revealClip(tc);
            }
          }

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
