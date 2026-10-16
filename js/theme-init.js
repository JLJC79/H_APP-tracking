// Applies the saved theme before first paint to avoid a flash of the wrong theme.
// Loaded as a classic (blocking) script so it runs before the stylesheet paints.
try {
  var t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable: fall back to system theme */ }
