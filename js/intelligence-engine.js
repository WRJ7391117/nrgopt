(function () {
  'use strict';

  var ns = 'http://www.w3.org/2000/svg';
  var figures = document.querySelectorAll('[data-engine-diagram]');
  if (!figures.length) return;

  function draw(figure) {
    var svg = figure.querySelector('.intel-diagram-wires');
    var frame = figure.getBoundingClientRect();
    if (!frame.width || !frame.height) return;
    var mobile = matchMedia('(max-width: 1040px)').matches;
    svg.setAttribute('viewBox', '0 0 ' + frame.width + ' ' + frame.height);
    svg.replaceChildren();

    var defs = document.createElementNS(ns, 'defs');
    var marker = document.createElementNS(ns, 'marker');
    marker.id = 'engine-arrow-' + figure.dataset.engineDiagram;
    [['viewBox', '0 0 10 10'], ['refX', '9'], ['refY', '5'], ['markerWidth', '7'], ['markerHeight', '7'], ['orient', 'auto-start-reverse']].forEach(function (entry) { marker.setAttribute(entry[0], entry[1]); });
    var head = document.createElementNS(ns, 'path');
    head.setAttribute('d', 'M1 1 L9 5 L1 9');
    head.setAttribute('fill', 'none');
    head.setAttribute('stroke', 'currentColor');
    head.setAttribute('stroke-width', '1.6');
    marker.appendChild(head);
    defs.appendChild(marker);
    svg.appendChild(defs);

    function box(id) {
      var element = figure.querySelector('[data-diagram-node="' + id + '"]');
      var rect = element.getBoundingClientRect();
      return { left: rect.left - frame.left, right: rect.right - frame.left, top: rect.top - frame.top, bottom: rect.bottom - frame.top, cx: rect.left - frame.left + rect.width / 2, cy: rect.top - frame.top + rect.height / 2, width: rect.width };
    }
    function wire(from, to, d, dashed, both, noEnd) {
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.8');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      if (dashed) path.setAttribute('stroke-dasharray', '5 5');
      if (!noEnd) path.setAttribute('marker-end', 'url(#' + marker.id + ')');
      if (both) path.setAttribute('marker-start', 'url(#' + marker.id + ')');
      path.dataset.from = from;
      path.dataset.to = to;
      svg.appendChild(path);
    }
    function across(from, to, both, dashed) {
      var a = box(from), b = box(to);
      wire(from, to, 'M' + a.right + ' ' + a.cy + ' H' + b.left, dashed, both);
    }
    function down(from, to, both, dashed) {
      var a = box(from), b = box(to);
      wire(from, to, 'M' + a.cx + ' ' + a.bottom + ' V' + b.top, dashed, both);
    }
    function turn(from, to, startX, endX, lane, dashed) {
      var a = box(from), b = box(to);
      wire(from, to, 'M' + startX + ' ' + a.bottom + ' V' + lane + ' H' + endX + ' V' + b.top, dashed);
    }

    if (figure.dataset.engineDiagram === 'flow') {
      for (var i = 1; i < 5; i++) mobile ? down('step' + i, 'step' + (i + 1)) : across('step' + i, 'step' + (i + 1));
      var first = box('step1'), last = box('step5');
      if (mobile) {
        var leftRail = 8, rightRail = frame.width - 8, failure = box('failure'), step2 = box('step2'), step3 = box('step3');
        wire('step5', 'step1', 'M' + last.left + ' ' + last.cy + ' H' + leftRail + ' V' + first.cy + ' H' + first.left, true);
        wire('step2', 'failure', 'M' + step2.right + ' ' + step2.cy + ' H' + rightRail + ' V' + failure.cy + ' H' + failure.right, true);
        wire('step3', 'failure', 'M' + step3.right + ' ' + step3.cy + ' H' + rightRail, true, false, true);
        down('failure', 'queue', false, true);
        down('queue', 'settings');
        down('settings', 'feishu');
      } else {
        wire('step5', 'step1', 'M' + last.cx + ' ' + last.top + ' V' + (first.top - 38) + ' H' + first.cx + ' V' + first.top, true);
        var s2 = box('step2'), s3 = box('step3'), f = box('failure'), q = box('queue');
        turn('step2', 'failure', s2.cx, f.left + f.width * .32, s2.bottom + 18, true);
        turn('step3', 'failure', s3.left + s3.width * .35, f.left + f.width * .68, s3.bottom + 36, true);
        turn('step3', 'queue', s3.left + s3.width * .7, q.cx, s3.bottom + 54);
        across('failure', 'queue', false, true);
        across('queue', 'settings');
        across('settings', 'feishu');
      }
    } else {
      if (mobile) {
        figure.querySelector('.intel-diagram-access-line').style.transform = '';
        down('browser', 'dns');
        down('dns', 'vercel');
        down('vercel', 'supabase', true);
        var v = box('vercel'), ext = box('external'), fs = box('feishu'), rail = frame.width - 8;
        wire('vercel', 'external', 'M' + v.right + ' ' + v.cy + ' H' + rail + ' V' + ext.cy + ' H' + ext.right);
        wire('vercel', 'feishu', 'M' + v.left + ' ' + v.cy + ' H8 V' + fs.cy + ' H' + fs.left);
        down('codex', 'github');
        down('github', 'deploy');
      } else {
        across('browser', 'dns');
        var dns = box('dns'), vercel = box('vercel'), feishu = box('feishu');
        var lane = dns.bottom + 16;
        var label = figure.querySelector('.intel-diagram-access-line');
        label.style.transform = '';
        var labelRect = label.getBoundingClientRect();
        label.style.transform = 'translate(' + ((dns.cx + vercel.cx) / 2 - (labelRect.left - frame.left + labelRect.width / 2)) + 'px, ' + (lane - (labelRect.top - frame.top + labelRect.height / 2)) + 'px)';
        wire('dns', 'vercel', 'M' + dns.cx + ' ' + dns.bottom + ' V' + lane + ' H' + vercel.cx + ' V' + vercel.top);
        across('supabase', 'vercel', true);
        across('vercel', 'external');
        wire('vercel', 'feishu', 'M' + vercel.cx + ' ' + vercel.bottom + ' V' + (vercel.bottom + 22) + ' H' + feishu.cx + ' V' + feishu.top);
        across('codex', 'github');
        across('github', 'deploy');
      }
    }
  }

  var redraw = function () { figures.forEach(draw); };
  var observer = new ResizeObserver(redraw);
  figures.forEach(function (figure) { observer.observe(figure); });
  addEventListener('resize', redraw);
  if (document.fonts) document.fonts.ready.then(redraw);
  redraw();
})();
