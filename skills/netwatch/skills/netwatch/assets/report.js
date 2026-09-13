/* Offline view controls. No fetches, command execution, or imported libraries. */
(() => {
  const rows = [...document.querySelectorAll('[data-flow]')];
  const search = document.getElementById('search');
  const status = document.getElementById('status');
  const kind = document.getElementById('kind');
  const visible = document.getElementById('visible');
  const update = () => {
    const query = search.value.toLowerCase().trim();
    let count = 0;
    for (const row of rows) {
      row.hidden = Boolean((query && !row.textContent.toLowerCase().includes(query))
        || (status.value && row.dataset.status !== status.value)
        || (kind.value && row.dataset.kind !== kind.value));
      if (!row.hidden) count++;
    }
    visible.textContent = `${count} of ${rows.length} socket flows shown${count ? '' : ' — no matching rows'}`;
  };
  search.addEventListener('input', update);
  status.addEventListener('change', update);
  kind.addEventListener('change', update);
  document.getElementById('reset').addEventListener('click', () => {
    search.value = ''; status.value = ''; kind.value = ''; update();
  });
  for (const table of document.querySelectorAll('table')) {
    for (const [index, heading] of [...table.querySelectorAll('th')].entries()) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = heading.textContent;
      button.setAttribute('aria-label', `Sort by ${heading.textContent}`);
      heading.textContent = ''; heading.append(button);
      let ascending = true;
      button.addEventListener('click', () => {
        const body = table.querySelector('tbody');
        const text = (row) => row.children[index]?.querySelector('summary')?.textContent || row.children[index]?.textContent || '';
        [...body.children].sort((a, b) => text(a).localeCompare(text(b), undefined, { numeric: true }) * (ascending ? 1 : -1)).forEach((r) => body.append(r));
        for (const h of table.querySelectorAll('th')) h.removeAttribute('aria-sort');
        heading.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
        ascending = !ascending;
      });
    }
  }
  update();
})();
