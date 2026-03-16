/**
 * cursor.js — Animated Loading Indicator (shield logo)
 *
 * API:
 *   Cursor.show('label')        – pulsing ring, database ops
 *   Cursor.show('label','proc') – spinning arc, calculations
 *   Cursor.hide()               – hide immediately
 *   Cursor.flash('label')       – green checkmark, auto-hide 900ms
 *   Cursor.wrap('label', fn)    – await fn() with auto show/hide
 */
const Cursor = (() => {

  function _isWindowsPlatform() {
    try {
      const rootPlatform = String(document.documentElement?.getAttribute('data-platform') || '').toLowerCase();
      if (rootPlatform === 'windows') return true;
      const nav = navigator || {};
      const ua = String(nav.userAgent || '').toLowerCase();
      const platform = String(nav.platform || '').toLowerCase();
      const uaDataPlatform = String(nav.userAgentData?.platform || '').toLowerCase();
      return /windows/.test(ua) || /win/.test(platform) || /windows/.test(uaDataPlatform);
    } catch (_) {
      return false;
    }
  }

  const _disabled = _isWindowsPlatform();

  let _el      = null;
  let _canvas  = null;
  let _label   = null;
  let _raf     = null;
  let _t0      = 0;
  let _mode    = 'load';
  let _timer   = null;

  const LOGO_SRC = 'logocursor.png';
  let _img = null, _imgReady = false;

  function _preload() {
    if (_img) return;
    _img = new Image();
    _img.onload  = () => { _imgReady = true; };
    _img.onerror = () => { _imgReady = false; };
    _img.src = LOGO_SRC;
  }

  function _init() {
    if (_el) return;
    _preload();

    _el = document.createElement('div');
    _el.id = 'ft-loader';
    Object.assign(_el.style, {
      position:      'fixed',
      bottom:        '22px',
      right:         '22px',
      zIndex:        '9800',
      display:       'none',
      flexDirection: 'column',
      alignItems:    'center',
      gap:           '6px',
      pointerEvents: 'none',
      userSelect:    'none',
    });

    _canvas = document.createElement('canvas');
    _canvas.width  = 72;
    _canvas.height = 72;
    // drop-shadow follows the shield alpha, not the bounding box
    _canvas.style.cssText = 'display:block;filter:drop-shadow(0 4px 14px rgba(0,0,0,.30)) drop-shadow(0 1px 4px rgba(0,0,0,.20));';

    _label = document.createElement('div');
    Object.assign(_label.style, {
      fontFamily:   "var(--font-sans,'Outfit',system-ui,sans-serif)",
      fontSize:     '.68rem',
      fontWeight:   '600',
      color:        'var(--text2,#3d3830)',
      background:   'var(--surface,#fff)',
      border:       '1px solid var(--border,#e8e4de)',
      borderRadius: '100px',
      padding:      '2px 10px',
      whiteSpace:   'nowrap',
      boxShadow:    '0 2px 8px rgba(0,0,0,.10)',
      maxWidth:     '160px',
      overflow:     'hidden',
      textOverflow: 'ellipsis',
    });

    _el.appendChild(_canvas);
    _el.appendChild(_label);
    document.body.appendChild(_el);

    const mq  = window.matchMedia('(max-width:640px)');
    const pos = q => {
      if (q.matches) {
        _el.style.right     = '50%';
        _el.style.bottom    = 'calc(var(--bottom-h,64px) + 22px + env(safe-area-inset-bottom,0px))';
        _el.style.transform = 'translateX(50%)';
      } else {
        _el.style.right     = '22px';
        _el.style.bottom    = '22px';
        _el.style.transform = '';
      }
    };
    pos(mq);
    mq.addEventListener('change', pos);
  }

  function _draw(ts) {
    if (!_el || _el.style.display === 'none') return;
    _raf = requestAnimationFrame(_draw);

    const ctx = _canvas.getContext('2d');
    const W = _canvas.width, H = _canvas.height;
    const CX = W / 2, CY = H / 2;
    const t  = (ts - _t0) / 1000;

    ctx.clearRect(0, 0, W, H);

    // Shield logo — full size, no white card, no circle clip
    const LW = 46, LH = 50;
    const lx = CX - LW / 2;
    const ly = CY - LH / 2 - 1;

    if (_imgReady) {
      if (_mode === 'load') {
        // Gentle vertical float
        const fy = Math.sin(t * Math.PI * 2 * 0.55) * 1.8;
        ctx.drawImage(_img, lx, ly + fy, LW, LH);
      } else if (_mode === 'proc') {
        // Subtle rock/wobble
        const wobble = Math.sin(t * Math.PI * 2 * 1.6) * 1.2;
        ctx.save();
        ctx.translate(CX, CY);
        ctx.rotate(wobble * Math.PI / 180);
        ctx.drawImage(_img, -LW / 2, -LH / 2 - 1, LW, LH);
        ctx.restore();
      } else {
        ctx.drawImage(_img, lx, ly, LW, LH);
      }
    } else {
      _fallbackShield(ctx, CX, CY, 22, t);
    }

    // Animated ring overlay
    if (_mode === 'load') {
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.1);

      // Outer breath glow
      ctx.beginPath();
      ctx.arc(CX, CY, 33 + pulse * 2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(58,184,85,${0.05 + 0.09 * pulse})`;
      ctx.lineWidth   = 4;
      ctx.stroke();

      // Rotating dashed ring
      ctx.save();
      ctx.translate(CX, CY);
      ctx.rotate(t * 0.45);
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = `rgba(42,96,73,${0.28 + 0.28 * pulse})`;
      ctx.lineWidth   = 2.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

    } else if (_mode === 'proc') {
      const a   = t * Math.PI * 2 * 1.6;
      const ARC = Math.PI * 1.25;

      // Track
      ctx.beginPath();
      ctx.arc(CX, CY, 32, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(42,96,73,0.12)';
      ctx.lineWidth   = 3;
      ctx.stroke();

      // Spinning arc
      ctx.beginPath();
      ctx.arc(CX, CY, 32, a, a + ARC);
      ctx.strokeStyle = '#2a6049';
      ctx.lineWidth   = 3;
      ctx.lineCap     = 'round';
      ctx.stroke();

      // Fading tail
      ctx.beginPath();
      ctx.arc(CX, CY, 32, a - Math.PI * 0.5, a);
      ctx.strokeStyle = 'rgba(42,96,73,0.22)';
      ctx.lineWidth   = 2;
      ctx.lineCap     = 'round';
      ctx.stroke();

    } else if (_mode === 'ok') {
      const p = Math.min(1, t * 2.8);
      const e = 1 - Math.pow(1 - p, 3);

      // Expanding success ring
      ctx.beginPath();
      ctx.arc(CX, CY, 27 + e * 7, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(42,122,74,${0.75 - e * 0.3})`;
      ctx.lineWidth   = 2.5;
      ctx.stroke();

      // Checkmark — appears after ring starts expanding
      if (p > 0.25) {
        const cp = Math.min(1, (p - 0.25) / 0.75);
        ctx.save();

        // White backing circle so checkmark is legible over the shield
        ctx.beginPath();
        ctx.arc(CX, CY + 3, 12, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${cp * 0.60})`;
        ctx.fill();

        ctx.strokeStyle  = '#1a5c3a';
        ctx.lineWidth    = 3.5;
        ctx.lineCap      = 'round';
        ctx.lineJoin     = 'round';
        ctx.globalAlpha  = cp;

        const x0 = CX - 8,  y0 = CY + 5;
        const xm = CX - 2,  ym = CY + 12;
        const x1 = CX + 11, y1 = CY - 2;

        ctx.beginPath();
        const p1x = x0 + (xm - x0) * Math.min(1, cp * 2);
        const p1y = y0 + (ym - y0) * Math.min(1, cp * 2);
        ctx.moveTo(x0, y0);
        ctx.lineTo(p1x, p1y);
        if (cp > 0.5) {
          const pp = (cp - 0.5) * 2;
          ctx.lineTo(xm + (x1 - xm) * pp, ym + (y1 - ym) * pp);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function _fallbackShield(ctx, cx, cy, r, t) {
    const p = 0.88 + 0.12 * Math.sin(t * Math.PI * 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(p, p);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.82, -r * 0.48);
    ctx.lineTo(r * 0.82, r * 0.22);
    ctx.quadraticCurveTo(r * 0.82, r * 0.92, 0, r * 1.12);
    ctx.quadraticCurveTo(-r * 0.82, r * 0.92, -r * 0.82, r * 0.22);
    ctx.lineTo(-r * 0.82, -r * 0.48);
    ctx.closePath();
    ctx.fillStyle = '#2a6049';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = r * 0.17;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.33, 0.08 * r);
    ctx.lineTo(-r * 0.05, r * 0.38);
    ctx.lineTo(r * 0.38, -r * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  function show(label = '', mode = 'load') {
    if (_disabled) return;
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _init();
    _mode = mode;
    _t0   = performance.now();
    _el.style.display    = 'flex';
    _label.textContent   = label || '';
    _label.style.display = label ? '' : 'none';
    if (!_raf) _raf = requestAnimationFrame(_draw);
  }

  function hide() {
    if (_disabled) return;
    if (!_el) return;
    _el.style.display = 'none';
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  }

  function flash(label = 'Salvo!') {
    if (_disabled) return;
    show(label, 'ok');
    _timer = setTimeout(hide, 900);
  }

  async function wrap(label, fn, mode = 'load') {
    if (_disabled) return await fn();
    show(label, mode);
    try   { return await fn(); }
    finally { hide(); }
  }

  if (!_disabled) {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', _preload);
    else
      _preload();
  }

  return { show, hide, flash, wrap, disabled: _disabled };

})();

window.Cursor = Cursor;
