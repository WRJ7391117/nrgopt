/**
 * NrgOpt — script.js
 * Enterprise Clean Energy Solutions
 * Theme toggle, form, scroll effects, analytics
 */
(function () {
  'use strict';

  // ── STATE ──
  function getTheme() {
    return localStorage.getItem('nrgopt-theme') || 'dark';
  }
  function setTheme(theme) {
    localStorage.setItem('nrgopt-theme', theme);
  }

  // ── THEME ──
  function updateThemeIcon() {
    var html = document.documentElement;
    var icon = document.getElementById('themeIcon');
    var btn = document.getElementById('themeBtn');
    var isDark = html.getAttribute('data-theme') === 'dark';
    if (isDark) {
      icon.innerHTML =
        '<circle cx="12" cy="12" r="5"/>' +
        '<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
      btn.setAttribute('aria-label', 'Switch to light mode');
      btn.title = 'Light mode';
    } else {
      icon.innerHTML =
        '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
      btn.setAttribute('aria-label', 'Switch to dark mode');
      btn.title = 'Dark mode';
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    setTheme(theme);
    updateThemeIcon();
  }

  window.toggleTheme = function () {
    var current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };

  // ── BACK TO TOP ──
  function createBackToTop() {
    var btn = document.createElement('button');
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '&#8593;';
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(btn);
    return btn;
  }

  // ── SCROLL SPY ──
  function setupScrollSpy() {
    var sections = document.querySelectorAll('section[id]');
    var navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            navLinks.forEach(function (link) {
              link.classList.toggle(
                'active',
                link.getAttribute('href') === '#' + entry.target.id
              );
            });
          }
        });
      },
      { rootMargin: '-30% 0px -60% 0px' }
    );
    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

  // ── REVEAL ON SCROLL ──
  function setupReveal() {
    var reveals = document.querySelectorAll('.reveal');
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    reveals.forEach(function (el) {
      observer.observe(el);
    });
  }

  // ── BACK TO TOP VISIBILITY ──
  function setupBackToTopVisibility(btn) {
    var ticking = false;
    window.addEventListener(
      'scroll',
      function () {
        if (!ticking) {
          requestAnimationFrame(function () {
            if (window.scrollY > 500) {
              btn.classList.add('visible');
            } else {
              btn.classList.remove('visible');
            }
            ticking = false;
          });
          ticking = true;
        }
      },
      { passive: true }
    );
  }

  // ── FORM SUBMISSION (Vercel Serverless → QQ SMTP) ──
  function setupForm() {
    var form = document.getElementById('contactForm');
    if (!form) return;
    var statusEl = document.getElementById('formStatus');
    var submitBtn = form.querySelector('.btn-submit');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = form.dataset.sendingText || '发送中...';
      statusEl.textContent = '';
      statusEl.className = 'form-status';

      var payload = {
        name: form.querySelector('[name="name"]').value,
        email: form.querySelector('[name="email"]').value,
        company: form.querySelector('[name="company"]').value,
        message: form.querySelector('[name="message"]').value,
      };

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (resp) { return resp.json(); })
        .then(function (data) {
          if (data.ok) {
            statusEl.textContent = form.dataset.successText || '已收到您的留言，我们会尽快回复。';
            statusEl.className = 'form-status success';
            form.reset();
          } else {
            throw new Error(data.error || 'Server error');
          }
        })
        .catch(function () {
          statusEl.textContent = form.dataset.errorText || '发送失败，请稍后重试。';
          statusEl.className = 'form-status error';
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = form.dataset.submitText || '发送';
        });
    });
  }

  // ── ANALYTICS (GA4) ──
  function setupAnalytics() {
    // Google Analytics 4 — replace G-XXXXXXXXXX with your Measurement ID
    var gaId = document.currentScript
      ? document.currentScript.getAttribute('data-ga-id')
      : null;
    if (!gaId) return;

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + gaId;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', gaId);

    // Track PDF downloads
    document.querySelectorAll('a[href$=".pdf"]').forEach(function (link) {
      link.addEventListener('click', function () {
        gtag('event', 'download', {
          event_category: 'pdf',
          event_label: link.getAttribute('href'),
        });
      });
    });
  }

  // ── LAZY LOAD ──
  function setupLazyImages() {
    // Native lazy loading via loading="lazy" on <img> tags
    // We also add a simple fade-in effect
    document.querySelectorAll('img[loading="lazy"]').forEach(function (img) {
      img.addEventListener('load', function () {
        img.style.opacity = '1';
      });
      img.style.transition = 'opacity 0.4s';
      img.style.opacity = '0';
    });
  }

  // ── INIT ──
  function init() {
    // Restore saved preferences
    applyTheme(getTheme());

    // UI enhancements
    var btt = createBackToTop();
    setupBackToTopVisibility(btt);
    setupScrollSpy();
    setupReveal();
    setupForm();
    setupLazyImages();
    setupAnalytics();

    // Detect system color scheme changes
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', function (e) {
        if (!localStorage.getItem('nrgopt-theme')) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
  }

  // Run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
