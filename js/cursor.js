/**
 * cursor.js — Animated Logo Loading Indicator
 * Shows a compact overlay with the app logo and an animated ring.
 *
 * API:
 *   Cursor.show('label')       – show with loading ring (database ops)
 *   Cursor.show('label','proc')– show with spinning arc (calculations)
 *   Cursor.hide()              – hide immediately
 *   Cursor.flash('label')      – show green checkmark, auto-hide in 800ms
 *   Cursor.wrap('label', fn)   – await fn() with auto show/hide
 */
const Cursor = (() => {
  let _el       = null;
  let _canvas   = null;
  let _labelEl  = null;
  let _raf      = null;
  let _t0       = 0;
  let _mode     = 'load';
  let _depth    = 0;
  let _timer    = null;

  const LOGO = 'logo.png';
  let _img = null, _imgOk = false;

  // Pre-load logo once
  function _preload() {
    if (_img) return;
    _img = new Image();
    _img.onload = () => { _imgOk = true; };
    _img.src = LOGO;
  }

  // Build DOM once, lazily
  function _init() {
    if (_el) return;
    _preload();

    _el = document.createElement('div');
    _el.id = 'ft-loader';
    Object.assign(_el.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '9800',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '5px',
      pointerEvents: 'none',
      userSelect: 'none',
    });

    _canvas = document.createElement('canvas');
    _canvas.width = _canvas.height = 56;
    Object.assign(_canvas.style, {
      display: 'block',
      filter: 'drop-shadow(0 3px 10px rgba(0,0,0,.18))',
    });

    _labelEl = document.createElement('div');
    Object.assign(_labelEl.style, {
      fontFamily: "var(--font-sans,'Outfit',system-ui,sans-serif)",
      fontSize: '.67rem',
      fontWeight: '600',
      color: 'var(--text2,#3d3830)',
      background: 'var(--surface,#fff)',
      border: '1px solid var(--border,#e8e4de)',
      borderRadius: '100px',
      padding: '2px 9px',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 6px rgba(0,0,0,.09)',
      maxWidth: '150px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });

    _el.appendChild(_canvas);
    _el.appendChild(_labelEl);
    document.body.appendChild(_el);

    // Reposition on small screens
    const mq = window.matchMedia('(max-width:640px)');
    const repos = q => {
      if (q.matches) {
        _el.style.right     = '50%';
        _el.style.bottom    = 'calc(var(--bottom-h,64px) + 20px + env(safe-area-inset-bottom,0px))';
        _el.style.transform = 'translateX(50%)';
      } else {
        _el.style.right     = '20px';
        _el.style.bottom    = '20px';
        _el.style.transform = '';
      }
    };
    repos(mq);
    mq.addEventListener('change', repos);
  }

  // ── Draw loop ──────────────────────────────────────────────────────
  function _draw(ts) {
    if (!_el || _el.style.display === 'none') return;
    _raf = requestAnimationFrame(_draw);

    const ctx = _canvas.getContext('2d');
    const S = _canvas.width, C = S / 2;
    const t = (ts - _t0) / 1000;

    ctx.clearRect(0, 0, S, S);

    // Card background
    ctx.beginPath();
    _roundRect(ctx, 3, 3, S - 6, S - 6, 12);
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.shadowColor = 'rgba(0,0,0,.12)';
    ctx.shadowBlur  = 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Logo
    if (_imgOk) {
      const r = 14;
      ctx.save();
      ctx.beginPath();
      ctx.arc(C, C, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(_img, C - r, C - r, r * 2, r * 2);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(C, C, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#2a6049';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('F', C, C);
    }

    // Animation ring
    if (_mode === 'load') {
      const p = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.1);
      const R = 22;
      ctx.beginPath();
      ctx.arc(C, C, R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(42,96,73,${.2 + .35 * p})`;
      ctx.lineWidth   = 2 + p * 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(C, C, R + 3 + p * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(42,96,73,${.08 * (1 - p)})`;
      ctx.lineWidth   = 1;
      ctx.stroke();

    } else if (_mode === 'proc') {
      const a = t * Math.PI * 3;
      ctx.beginPath();
      ctx.arc(C, C, 22, a, a + Math.PI * 1.15);
      ctx.strokeStyle = '#2a6049';
      ctx.lineWidth   = 3;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(C, C, 17, -a * .8, -a * .8 + Math.PI * .55);
      ctx.strokeStyle = 'rgba(42,96,73,.3)';
      ctx.lineWidth   = 2;
      ctx.lineCap     = 'round';
      ctx.stroke();

    } else if (_mode === 'ok') {
      const p = Math.min(1, t * 3);
      const e = 1 - Math.pow(1 - p, 3);
      ctx.beginPath();
      ctx.arc(C, C, 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(42,122,74,${e * .75})`;
      ctx.lineWidth   = 2;
      ctx.stroke();
      if (p > .25) {
        const cp = Math.min(1, (p - .25) / .75);
        ctx.save();
        ctx.strokeStyle = '#2a7a4a';
        ctx.lineWidth   = 2.8;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        const x0 = C - 7, y0 = C + 1, xm = C - 2, ym = C + 6, x1 = C + 8, y1 = C - 5;
        const p1x = x0 + (xm - x0) * Math.min(1, cp * 2);
        const p1y = y0 + (ym - y0) * Math.min(1, cp * 2);
        ctx.moveTo(x0, y0);
        ctx.lineTo(p1x, p1y);
        if (cp > .5) {
          const pp = (cp - .5) * 2;
          ctx.lineTo(xm + (x1 - xm) * pp, ym + (y1 - ym) * pp);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function _roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ── Public API ─────────────────────────────────────────────────────
  function show(label = '', mode = 'load') {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _init();
    _mode = mode;
    _t0   = performance.now();
    _el.style.display = 'flex';
    _labelEl.textContent = label || '';
    _labelEl.style.display = label ? '' : 'none';
    if (!_raf) _raf = requestAnimationFrame(_draw);
  }

  function hide() {
    _depth = 0;
    if (!_el) return;
    _el.style.display = 'none';
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  }

  function flash(label = 'Salvo!') {
    show(label, 'ok');
    _timer = setTimeout(hide, 800);
  }

  async function wrap(label, fn, mode = 'load') {
    show(label, mode);
    try   { return await fn(); }
    finally { hide(); }
  }

  // Preload on DOMContentLoaded
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', _preload);
  else
    _preload();

  return { show, hide, flash, wrap };
})();

window.Cursor = Cursor;
