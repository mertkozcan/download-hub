const $ = s => document.querySelector(s);
chrome.storage.local.get({ token: '', enabled: true, minMB: 0 }).then(c => { $('#token').value = c.token; $('#enabled').checked = c.enabled; $('#min').value = c.minMB; });
$('#save').onclick = async () => {
  await chrome.storage.local.set({ token: $('#token').value.trim(), enabled: $('#enabled').checked, minMB: +$('#min').value || 0 });
  $('#ok').textContent = 'Kaydedildi';
};
