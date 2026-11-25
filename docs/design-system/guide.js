const byId = (id) => document.getElementById(id);
const all = (selector) => [...document.querySelectorAll(selector)];
const appPath = '../../src/app/';

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(label, path) {
  const anchor = element('a', label);
  anchor.href = appPath + path;
  return anchor;
}

function icon(className) {
  const brandIcons = ['fa-google', 'fa-instagram', 'fa-spotify', 'fa-x-twitter', 'fa-youtube'];
  const node = element(
    'i',
    '',
    (brandIcons.includes(className) ? 'fa-brands ' : 'fa-solid ') + className,
  );
  node.setAttribute('aria-hidden', 'true');
  return node;
}

async function copyColor(value) {
  try {
    await navigator.clipboard.writeText(value);
    byId('copy-status').textContent = 'Copied ' + value;
  } catch {
    byId('copy-status').textContent = 'Color value ' + value + ' · copy it from the token table.';
  }
}

function renderFoundations() {
  uiReference.featuredSwatches.forEach((index) => {
    const [name, , value] = uiReference.tokens[index];
    const button = element('button', '', 'swatch');
    button.type = 'button';
    button.style.setProperty('--sample', value);
    button.setAttribute('aria-label', 'Copy ' + name + ' ' + value);
    const info = element('span', '', 'swatch-info');
    info.append(element('strong', name), element('code', value));
    button.append(element('span', '', 'swatch-fill'), info);
    button.addEventListener('click', () => copyColor(value));
    byId('palette').append(button);
  });

  const tokenTable = element('table');
  const header = tokenTable.createTHead().insertRow();
  ['Role', 'CSS custom property', 'Value'].forEach((text) => {
    const cell = element('th', text);
    cell.scope = 'col';
    header.append(cell);
  });
  const body = tokenTable.createTBody();
  uiReference.tokens.forEach(([name, token, value]) => {
    const row = body.insertRow();
    const heading = element('th', name);
    heading.scope = 'row';
    row.append(heading);
    const tokenCell = row.insertCell();
    token.split(' / ').forEach((alias, index) => {
      if (index > 0) tokenCell.append(' / ');
      tokenCell.append(element('code', alias));
    });
    row.insertCell().textContent = value;
  });
  byId('token-table').append(tokenTable);

  function luminance(hex) {
    const channels = hex
      .slice(1)
      .match(/../g)
      .map((pair) => parseInt(pair, 16) / 255);
    const [r, g, b] = channels.map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(first, second) {
    const levels = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return ((levels[0] + 0.05) / (levels[1] + 0.05)).toFixed(2) + ':1';
  }

  byId('contrast-value').textContent = contrast('#0E0D0B', '#FF4D68');
  byId('contrast-value').parentElement.nextElementSibling.append(
    ' White on the same pink is ' + contrast('#FFFFFF', '#FF4D68') + '.',
  );

  uiReference.scopedPalettes.forEach(([name, colors, description, file]) => {
    const article = element('article');
    const samples = element('div', '', 'mini-swatches');
    colors.forEach((hex) => {
      const sample = element('span', hex);
      sample.style.setProperty('--sample', hex);
      samples.append(sample);
    });
    article.append(element('h4', name), samples, element('p', description), link('Source', file));
    byId('scoped-palettes').append(article);
  });

  function createTile(label, className) {
    const tile = element('div', '', 'icon-tile');
    tile.append(icon(className));
    if (label) tile.append(element('strong', label));
    tile.append(element('code', className));
    return tile;
  }

  uiReference.icons.forEach(([label, glyph]) =>
    byId('icon-grid').append(createTile(label, 'fa-' + glyph)),
  );
  const inventory = element('details', '', 'disclosure');
  const search = element('input');
  const searchField = element('div', '', 'field icon-search');
  const label = element('label', 'Filter by icon class');
  label.htmlFor = 'icon-filter';
  search.type = 'search';
  search.id = label.htmlFor;
  search.placeholder = 'Search icon classes';
  const grid = element('div', '', 'icon-grid full-icon-grid');
  const count = element('p', '', 'note icon-count');
  count.setAttribute('role', 'status');
  const tiles = uiReference.iconClasses.map((className) => createTile('', className));
  grid.append(...tiles);
  function filterIcons() {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    tiles.forEach((tile, index) => {
      tile.hidden = !uiReference.iconClasses[index].includes(query);
      visible += Number(!tile.hidden);
    });
    count.textContent = visible + ' icon classes';
  }
  searchField.append(label, search);
  inventory.append(
    element('summary', 'All Font Awesome classes found in app source'),
    element(
      'p',
      'Inventory of literal fa-* icon references in app templates and TypeScript. Aliases remain visible for migration. Regular and Solid variants can share the same class name.',
    ),
    searchField,
    count,
    grid,
  );
  search.addEventListener('input', filterIcons);
  filterIcons();
  byId('icon-grid').after(inventory);
}

function renderAudit() {
  const priorities = {
    high: ['High', 'danger'],
    medium: ['Medium', 'warning'],
    low: ['Low', 'neutral'],
  };
  uiReference.findings.forEach(([severity, category, title, evidence, action, files]) => {
    const [priority, tone] = priorities[severity];
    const finding = element('details', '', 'finding');
    finding.dataset.priority = severity;
    const summary = element('summary');
    summary.append(
      element('span', priority, 'priority badge ' + tone),
      element('span', category, 'finding-category'),
      element('strong', title),
    );
    const content = element('div', '', 'finding-body');
    const change = element('p');
    change.append(element('strong', 'Proposed fix. '), action);
    const sources = element('p', '', 'source');
    files.forEach(([label, file], index) => {
      if (index > 0) sources.append(' · ');
      sources.append(link(label, file));
    });
    content.append(element('p', evidence), change, sources);
    finding.append(summary, content);
    byId('findings').append(finding);
  });

  const filters = all('[data-filter]');
  const findings = all('[data-priority]');
  function filterFindings(priority) {
    filters.forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.filter === priority)),
    );
    findings.forEach((finding) => {
      finding.hidden = priority !== 'all' && finding.dataset.priority !== priority;
    });
    const visible = findings.filter((finding) => !finding.hidden).length;
    byId('finding-count').textContent = visible + ' of ' + findings.length + ' findings';
  }
  filters.forEach((button) =>
    button.addEventListener('click', () => filterFindings(button.dataset.filter)),
  );
  filterFindings('all');

  uiReference.coverage.forEach(([section, detail]) => {
    const row = element('p');
    row.append(element('strong', section + '. '), detail);
    byId('coverage').append(row);
  });
  const sources = element('p', '', 'source');
  sources.append(
    link('Route map', 'app.routes.ts'),
    ' · ',
    link('Feature guards', 'core/config/feature-availability.ts'),
  );
  byId('coverage').append(sources);
}

function wireSpecimens() {
  let toastTimer;
  function flash(message) {
    clearTimeout(toastTimer);
    const toast = byId('demo-toast');
    toast.textContent = message;
    toastTimer = setTimeout(() => {
      toast.textContent = '';
    }, 3100);
  }

  const dialog = byId('license-dialog');
  all('#open-dialog, [data-open-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      dialog.returnValue = '';
      dialog.showModal();
    });
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm') flash('License added to the example cart');
  });
  all('[data-example]').forEach((button) => {
    button.addEventListener('click', () => flash(button.dataset.example));
  });

  all('.chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    }),
  );
  const playButtons = all('[data-play]');
  playButtons.forEach((button) =>
    button.addEventListener('click', () => {
      const isPlaying = button.getAttribute('aria-pressed') !== 'true';
      playButtons.forEach((control) => {
        control.setAttribute('aria-pressed', String(isPlaying));
        control.setAttribute('aria-label', (isPlaying ? 'Pause' : 'Play') + ' After Hours');
        control.replaceChildren(icon(isPlaying ? 'fa-pause' : 'fa-play'));
      });
    }),
  );
  document.querySelector('.transport input').addEventListener('input', (event) => {
    const seconds = Number(event.target.value);
    byId('elapsed').textContent =
      Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' / 1:32';
  });

  const data = [
    [
      ['After Hours', 'Published', '1,284'],
      ['In Motion', 'Draft', '0'],
    ],
    [
      ['Midnight Tape', 'Published', '860'],
      ['Soft Focus', 'Processing', '0'],
    ],
    [
      ['Night Drive', 'Published', '440'],
      ['Low End', 'Draft', '0'],
    ],
  ];
  const tone = { Published: 'success', Processing: 'warning', Draft: 'neutral' };
  let page = 1;
  const numberButtons = all('[data-page]');
  const stepButtons = all('[data-page-step]');
  function setPage(nextPage) {
    page = Math.max(1, Math.min(data.length, nextPage));
    const body = byId('track-rows');
    body.replaceChildren();
    data[page - 1].forEach(([title, status, plays]) => {
      const row = body.insertRow();
      const track = element('th', title);
      track.scope = 'row';
      row.append(track);
      row.insertCell().append(element('span', status, 'badge ' + tone[status]));
      row.insertCell().append(element('span', plays));
      row.lastElementChild.className = 'number';
    });
    numberButtons.forEach((button) => {
      if (Number(button.dataset.page) === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    stepButtons.forEach((button) => {
      const target = page + Number(button.dataset.pageStep);
      button.disabled = target < 1 || target > data.length;
    });
  }
  numberButtons.forEach((button) =>
    button.addEventListener('click', () => setPage(Number(button.dataset.page))),
  );
  stepButtons.forEach((button) =>
    button.addEventListener('click', () => setPage(page + Number(button.dataset.pageStep))),
  );
}

renderFoundations();
renderAudit();
wireSpecimens();
