import { qs } from '../lib/dom.js';

const PERSONAL_ID = 'personal';
const STORAGE_KEY = 'daily-planner:workspace';

export function workspaceOptions(profile) {
  const organizations = Array.isArray(profile?.organizations) ? profile.organizations : [];
  return [
    { id: PERSONAL_ID, name: 'Personal', kind: 'personal' },
    ...organizations
      .filter((organization) => organization && typeof organization.id === 'string' && typeof organization.name === 'string')
      .map((organization) => ({ id: organization.id, name: organization.name.trim() || 'Workspace', kind: 'enterprise' }))
  ];
}

export function createWorkspaceFeature({ apiUrl = '' } = {}) {
  const endpoint = String(apiUrl || '').trim().replace(/\/$/, '');
  const desktop = qs('[data-workspace-switcher]');
  const desktopMenu = qs('[data-workspace-menu]');
  const desktopToggle = qs('[data-workspace-toggle]');
  const mobile = qs('[data-mobile-workspace]');
  const mobileOptions = qs('[data-mobile-workspace-options]');
  const mobileToggle = qs('[data-mobile-workspace-toggle]');
  const planner = qs('[data-workspace]');
  const mobileViewSwitch = qs('[data-mobile-view-switch]');
  const enterpriseShell = qs('[data-enterprise-workspace]');
  let options = [{ id: PERSONAL_ID, name: 'Personal', kind: 'personal' }];
  let selectedId = PERSONAL_ID;

  const closeMenus = () => {
    if (desktopMenu) desktopMenu.hidden = true;
    if (desktopToggle) desktopToggle.setAttribute('aria-expanded', 'false');
    if (mobileOptions) mobileOptions.hidden = true;
    if (mobileToggle) mobileToggle.setAttribute('aria-expanded', 'false');
  };

  const select = (id, { persist = true } = {}) => {
    const selected = options.find((option) => option.id === id) || options[0];
    selectedId = selected.id;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, selectedId); } catch {}
    }
    qs('[data-workspace-label]')?.replaceChildren(selected.name);
    qs('[data-mobile-workspace-label]')?.replaceChildren(selected.name);
    planner.dataset.workspaceMode = selected.kind;
    if (enterpriseShell) enterpriseShell.hidden = selected.kind !== 'enterprise';
    if (selected.kind === 'enterprise') qs('[data-enterprise-workspace-name]')?.replaceChildren(selected.name);
    if (mobileViewSwitch) mobileViewSwitch.hidden = selected.kind === 'enterprise';
    renderMenus();
    closeMenus();
  };

  const renderMenu = (container) => {
    if (!container) return;
    container.replaceChildren(...options.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.workspaceId = option.id;
      button.setAttribute('aria-current', String(option.id === selectedId));
      const label = document.createElement('span');
      label.textContent = option.name;
      const kind = document.createElement('small');
      kind.textContent = option.kind === 'personal' ? 'Private' : 'Team';
      button.append(label, kind);
      button.addEventListener('click', () => select(option.id));
      return button;
    }));
  };

  function renderMenus() {
    renderMenu(desktopMenu);
    renderMenu(mobileOptions);
  }

  desktopToggle?.addEventListener('click', () => {
    const open = desktopMenu?.hidden !== false;
    closeMenus();
    if (desktopMenu) desktopMenu.hidden = !open;
    desktopToggle.setAttribute('aria-expanded', String(open));
  });

  mobileToggle?.addEventListener('click', () => {
    const open = mobileOptions?.hidden !== false;
    closeMenus();
    if (mobileOptions) mobileOptions.hidden = !open;
    mobileToggle.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (event) => {
    if (desktop?.contains(event.target) || mobile?.contains(event.target)) return;
    closeMenus();
  });

  async function load() {
    if (!endpoint || !desktop || !planner) return;
    try {
      const response = await fetch(`${endpoint}/v1/me`, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      options = workspaceOptions(await response.json());
      if (options.length <= 1) return;
      desktop.hidden = false;
      if (mobile) mobile.hidden = false;
      let preferred = PERSONAL_ID;
      try { preferred = localStorage.getItem(STORAGE_KEY) || PERSONAL_ID; } catch {}
      select(preferred, { persist: false });
    } catch {}
  }

  return { load, select, options: () => [...options] };
}
