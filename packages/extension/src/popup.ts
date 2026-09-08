import { blobToDataUrl } from './dataUrl';
import {
  deleteVaultItem,
  listVaultItems,
  readVaultDocument,
  saveVaultItem,
  VaultLockedError,
  type VaultItemMeta,
} from './vault';
import {
  getUnlockedVault,
  hasVault,
  lockVault,
  PROFILE_FIELD_KEYS,
  saveVaultSecrets,
  unlockVault,
  type Profile,
  type ProfileFieldKey,
} from './profile';

const listEl = document.getElementById('list') as HTMLDivElement;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const form = document.getElementById('add') as HTMLFormElement;
const labelInput = document.getElementById('label') as HTMLInputElement;
const kindInput = document.getElementById('kind') as HTMLSelectElement;
const fileInput = document.getElementById('file') as HTMLInputElement;

function renderItem(item: VaultItemMeta): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'item';

  // The thumbnail is decrypted on demand rather than held in the listing,
  // so a locked vault shows nothing and an open one costs one read per row.
  const img = document.createElement('img');
  void readVaultDocument(item.id).then((dataUrl) => {
    img.src = dataUrl;
  });
  row.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = item.label;
  const kind = document.createElement('div');
  kind.className = 'kind';
  kind.textContent = item.kind;
  meta.appendChild(label);
  meta.appendChild(kind);
  row.appendChild(meta);

  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.addEventListener('click', async () => {
    await deleteVaultItem(item.id);
    await refresh();
  });
  row.appendChild(remove);

  return row;
}

async function refresh(): Promise<void> {
  listEl.innerHTML = '';
  let items: VaultItemMeta[];
  try {
    items = await listVaultItems();
  } catch (error) {
    // Documents are encrypted under the vault passphrase now, so there is
    // nothing to show until it is unlocked. Say which tab does that rather
    // than showing an empty list that looks like lost data.
    emptyEl.hidden = false;
    emptyEl.textContent =
      error instanceof VaultLockedError
        ? 'Vault locked — unlock it under "Profile & keys" to see your saved documents.'
        : `Could not read the vault: ${error instanceof Error ? error.message : String(error)}`;
    form.hidden = true;
    return;
  }

  form.hidden = false;
  emptyEl.hidden = items.length > 0;
  emptyEl.textContent = 'No documents saved yet.';
  for (const item of items) {
    listEl.appendChild(renderItem(item));
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) return;
  const dataUrl = await blobToDataUrl(file);
  try {
    await saveVaultItem({
      label: labelInput.value.trim() || file.name,
      kind: kindInput.value as VaultItemMeta['kind'],
      dataUrl,
    });
  } catch (error) {
    emptyEl.hidden = false;
    emptyEl.textContent =
      error instanceof VaultLockedError
        ? 'Unlock the vault under "Profile & keys" before saving a document — documents are encrypted with that passphrase.'
        : `Could not save: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  form.reset();
  await refresh();
});

refresh();

// --- Tabs ---

const tabDocs = document.getElementById('tab-docs') as HTMLButtonElement;
const tabProfile = document.getElementById('tab-profile') as HTMLButtonElement;
const panelDocs = document.getElementById('panel-docs') as HTMLDivElement;
const panelProfile = document.getElementById('panel-profile') as HTMLDivElement;

function showTab(tab: 'docs' | 'profile') {
  tabDocs.classList.toggle('active', tab === 'docs');
  tabProfile.classList.toggle('active', tab === 'profile');
  panelDocs.classList.toggle('active', tab === 'docs');
  panelProfile.classList.toggle('active', tab === 'profile');
}
tabDocs.addEventListener('click', () => showTab('docs'));
tabProfile.addEventListener('click', () => showTab('profile'));

// --- Profile & keys ---

const lockStatusEl = document.getElementById('lock-status') as HTMLDivElement;
const unlockForm = document.getElementById('unlock-form') as HTMLFormElement;
const unlockPassphraseInput = document.getElementById('unlock-passphrase') as HTMLInputElement;
const profileForm = document.getElementById('profile-form') as HTMLFormElement;
const setupForm = document.getElementById('setup-form') as HTMLFormElement;
const setupPassphraseInput = document.getElementById('setup-passphrase') as HTMLInputElement;
const lockNowButton = document.getElementById('lock-now') as HTMLButtonElement;

/** Held only for the lifetime of this popup document — never persisted. */
let sessionPassphrase: string | null = null;

function profileInput(key: ProfileFieldKey): HTMLInputElement {
  return document.getElementById(`pf-${key}`) as HTMLInputElement;
}

function fillProfileForm(profile: Profile) {
  for (const key of PROFILE_FIELD_KEYS) profileInput(key).value = profile[key] ?? '';
}

function readProfileForm(): Profile {
  const profile: Profile = {};
  for (const key of PROFILE_FIELD_KEYS) {
    const value = profileInput(key).value.trim();
    if (value) profile[key] = value;
  }
  return profile;
}

async function refreshProfilePanel(): Promise<void> {
  const unlocked = await getUnlockedVault();
  if (unlocked) {
    lockStatusEl.textContent = 'Vault unlocked for this browser session.';
    lockStatusEl.className = 'lock-status unlocked';
    unlockForm.hidden = true;
    setupForm.hidden = true;
    profileForm.hidden = false;
    fillProfileForm(unlocked.profile);
    return;
  }

  profileForm.hidden = true;
  lockStatusEl.textContent = 'Vault locked.';
  lockStatusEl.className = 'lock-status locked';

  const exists = await hasVault();
  unlockForm.hidden = !exists;
  setupForm.hidden = exists;
}

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await unlockVault(unlockPassphraseInput.value);
    sessionPassphrase = unlockPassphraseInput.value;
    unlockPassphraseInput.value = '';
    await refreshProfilePanel();
    await refresh();
  } catch {
    lockStatusEl.textContent = 'Wrong passphrase.';
    lockStatusEl.className = 'lock-status locked';
  }
});

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  sessionPassphrase = setupPassphraseInput.value;
  await saveVaultSecrets({ profile: {} }, sessionPassphrase);
  setupPassphraseInput.value = '';
  await refreshProfilePanel();
  await refresh();
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!sessionPassphrase) {
    // Popup was reopened after unlocking in a previous popup instance —
    // the vault is still unlocked in chrome.storage.session, but we no
    // longer hold the passphrase needed to re-encrypt. Ask again.
    lockStatusEl.textContent = 'Re-enter your passphrase to save changes.';
    profileForm.hidden = true;
    unlockForm.hidden = false;
    return;
  }
  await saveVaultSecrets({ profile: readProfileForm() }, sessionPassphrase);
  lockStatusEl.textContent = 'Saved.';
});

lockNowButton.addEventListener('click', async () => {
  await lockVault();
  sessionPassphrase = null;
  await refreshProfilePanel();
  await refresh();
});

refreshProfilePanel();
