import { blobToDataUrl, deleteVaultItem, listVaultItems, saveVaultItem, type VaultItem } from './vault';

const listEl = document.getElementById('list') as HTMLDivElement;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const form = document.getElementById('add') as HTMLFormElement;
const labelInput = document.getElementById('label') as HTMLInputElement;
const kindInput = document.getElementById('kind') as HTMLSelectElement;
const fileInput = document.getElementById('file') as HTMLInputElement;

function renderItem(item: VaultItem): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'item';

  const img = document.createElement('img');
  img.src = item.dataUrl;
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
  const items = await listVaultItems();
  listEl.innerHTML = '';
  emptyEl.hidden = items.length > 0;
  for (const item of items) {
    listEl.appendChild(renderItem(item));
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) return;
  const dataUrl = await blobToDataUrl(file);
  await saveVaultItem({
    label: labelInput.value.trim() || file.name,
    kind: kindInput.value as VaultItem['kind'],
    dataUrl,
  });
  form.reset();
  await refresh();
});

refresh();
