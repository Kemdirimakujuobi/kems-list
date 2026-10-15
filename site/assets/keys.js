// Keyboard navigation for the public site, Tempo-style. The site works fully without it.
(() => {
  const typing = (e) => e.target.closest('input, textarea, select, [contenteditable]');
  const body = document.body;

  // Piece page: j = older, k = newer, Esc = back to the list.
  if (body.dataset.home) {
    document.addEventListener('keydown', (e) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const go = { j: body.dataset.next, k: body.dataset.prev, Escape: body.dataset.home }[e.key];
      if (go) { e.preventDefault(); location.href = go; }
    });
    return;
  }

  // List: j/k move a highlight, Enter or o opens.
  const rows = [...document.querySelectorAll('.row')];
  if (!rows.length) return;
  let index = -1;
  const select = (i) => {
    rows[index]?.classList.remove('is-active');
    index = Math.max(0, Math.min(rows.length - 1, i));
    rows[index].classList.add('is-active');
    rows[index].focus({ preventScroll: true });
    rows[index].scrollIntoView({ block: 'nearest' });
  };
  document.addEventListener('keydown', (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'j') { e.preventDefault(); select(index + 1); }
    else if (e.key === 'k') { e.preventDefault(); select(index - 1); }
    else if ((e.key === 'o' || e.key === 'Enter') && index >= 0) { e.preventDefault(); rows[index].click(); }
  });
})();
