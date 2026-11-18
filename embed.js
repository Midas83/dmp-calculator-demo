/*
 * DMP Savings Calculator — partner embed script.
 *
 * Partner usage (one line):
 *   <script src="https://YOUR-HOST/embed.js" data-partner="partner-id" async></script>
 *
 * Optional attributes:
 *   data-target="#some-element"  put the calculator inside this element
 *                                (default: right where the script tag is)
 *   data-max-width="760px"       limit the calculator width
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var src = new URL(script.src, location.href);
  var base = src.href.replace(/[^/]*$/, '');           // folder that holds embed.js
  var widgetOrigin = src.origin;
  var partner = (script.getAttribute('data-partner') || 'default').toLowerCase().replace(/[^a-z0-9-]/g, '');
  var instance = 'dmpc-' + Math.random().toString(36).slice(2, 10);

  var iframe = document.createElement('iframe');
  iframe.src = base + 'widget/index.html?partner=' + encodeURIComponent(partner) + '&i=' + instance;
  iframe.title = 'Debt management plan savings calculator';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('scrolling', 'no');
  // Only what the widget needs: scripts, its own origin for config fetches, the in-page
  // form (nothing is sent anywhere), and the tel: link.
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-top-navigation-by-user-activation allow-popups');
  iframe.style.cssText = 'display:block;width:100%;border:0;height:900px;overflow:hidden;color-scheme:normal;';
  var maxW = script.getAttribute('data-max-width');
  if (maxW) iframe.style.maxWidth = maxW;

  var wrap = document.createElement('div');
  wrap.className = 'dmp-calculator-embed';
  wrap.appendChild(iframe);

  var targetSel = script.getAttribute('data-target');
  var target = targetSel ? document.querySelector(targetSel) : null;
  if (target) target.appendChild(wrap);
  else script.parentNode.insertBefore(wrap, script.nextSibling);

  window.addEventListener('message', function (e) {
    if (e.origin !== widgetOrigin || e.source !== iframe.contentWindow) return;
    var d = e.data;
    if (!d || d.instance !== instance) return;
    if (d.type === 'dmpc:resize') {
      var h = Number(d.height);
      if (h > 0 && h < 10000) iframe.style.height = h + 'px';
    } else if (d.type === 'dmpc:scrollTop') {
      // On a step change, bring the top of the calculator into view if it is off screen.
      var top = iframe.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.5) {
        var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: window.pageYOffset + top - 16, behavior: reduce ? 'auto' : 'smooth' });
      }
    }
  });
})();
