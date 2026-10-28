// Text recognition runs locally. Only a title explicitly submitted by the
// user is passed to the app's existing TMDB search.
export function titleSuggestions(data) {
  const lines = (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(p => p.lines || []));
  const candidates = lines.length ? lines.map(line => ({ text: line.text || '', height: Math.max(1, (line.bbox?.y1 || 0) - (line.bbox?.y0 || 0)) }))
    : String(data.text || '').split(/\r?\n/).map(text => ({ text, height: 1 }));
  const seen = new Set();
  return candidates.sort((a, b) => b.height - a.height).map(line => line.text.replace(/\s+/g, ' ').trim())
    .filter(text => {
      const key = text.toLocaleLowerCase('sv');
      if (text.length < 2 || text.length > 100 || !/[a-zåäöé]/i.test(text) || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
}

async function photoCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('invalid image');
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

export function createCoverReader({ onStart, onSearch }, dependencies = {}) {
  const $ = id => document.getElementById(id);
  const loadEngine = dependencies.loadEngine || (() => import('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js'));
  const prepareImage = dependencies.prepareImage || photoCanvas;
  let version = 0, worker = null, timer = null, barcode = '';
  function reset() {
    version++;
    clearTimeout(timer);
    if (worker) { worker.terminate().catch(() => {}); worker = null; }
    $('cover-file').disabled = false;
    $('cover-file').value = '';
    $('cover-preview').removeAttribute('src');
    $('cover-preview').hidden = true;
    $('cover-result').hidden = true;
    $('cover-cancel').hidden = true;
    $('cover-title').value = '';
    $('cover-lines').replaceChildren();
    $('cover-text').textContent = '';
    $('cover-status').textContent = '';
    $('cover-barcode-option').hidden = true;
    $('cover-keep-barcode').checked = false;
    barcode = '';
  }
  $('cover-cancel').onclick = () => { reset(); $('cover-status').textContent = 'Fotoläsningen är avbruten. Du kan söka manuellt eller ta en ny bild.'; };
  $('cover-file').onchange = async () => {
    const file = $('cover-file').files?.[0];
    if (!file) return;
    reset();
    if (file.size > 20 * 1024 * 1024 || (file.type && !file.type.startsWith('image/'))) {
      $('cover-status').textContent = 'Välj en bild på högst 20 MB. Du kan också söka på titeln manuellt nedan.';
      return;
    }
    const context = onStart();
    if (context === false) return;
    barcode = context || '';
    const current = version;
    $('cover-file').disabled = true;
    $('cover-cancel').hidden = false;
    $('cover-status').textContent = 'Förbereder bilden. Första gången behöver textläsaren hämtas; det kan ta en stund.';
    timer = setTimeout(() => { if (current === version) { reset(); $('cover-status').textContent = 'Textläsningen tog för lång tid. Prova en närbild av bara titeln eller sök manuellt.'; } }, 90000);
    let localWorker = null;
    try {
      const canvas = await prepareImage(file);
      if (current !== version) return;
      $('cover-preview').src = canvas.toDataURL('image/jpeg', 0.8);
      $('cover-preview').hidden = false;
      const engine = await loadEngine();
      if (current !== version) return;
      const createWorker = engine.createWorker || engine.default?.createWorker;
      if (!createWorker) throw new Error('OCR engine unavailable');
      localWorker = await createWorker(['swe', 'eng'], 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
        cacheMethod: 'none',
        logger: event => {
          if (current === version && event.status === 'recognizing text') $('cover-status').textContent = `Läser text i bilden… ${Math.round((event.progress || 0) * 100)} %`;
        },
      });
      if (current !== version) return;
      worker = localWorker;
      await localWorker.setParameters({ tessedit_pageseg_mode: '11' });
      const { data } = await localWorker.recognize(canvas, {}, { text: true, blocks: true });
      if (current !== version) return;
      const suggestions = titleSuggestions(data);
      $('cover-title').value = suggestions[0] || '';
      $('cover-text').textContent = String(data.text || '').slice(0, 6000);
      for (const text of suggestions) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'secondary'; button.textContent = text;
        button.onclick = () => { $('cover-title').value = text; $('cover-title').focus(); };
        $('cover-lines').append(button);
      }
      $('cover-result').hidden = false;
      $('cover-barcode-option').hidden = !barcode;
      $('cover-keep-barcode').checked = !!barcode;
      $('cover-barcode-text').textContent = barcode ? `Använd streckkoden ${barcode} med denna film` : '';
      $('cover-status').textContent = suggestions.length
        ? 'Textförslag klara. Välj och rätta titeln innan du söker. Texten kan även vara skådespelarnamn eller en slogan.'
        : 'Ingen tydlig text hittades. Skriv titeln själv eller prova en närbild av bara titeln.';
    } catch {
      if (current === version) $('cover-status').textContent = 'Bilden kunde inte läsas. Prova en tydlig JPG- eller PNG-bild, eller sök på titeln manuellt nedan.';
    } finally {
      if (current === version) {
        clearTimeout(timer); worker = null; $('cover-file').disabled = false;
      }
      if (localWorker) await localWorker.terminate().catch(() => {});
    }
  };
  $('cover-search-form').onsubmit = event => {
    event.preventDefault();
    const title = $('cover-title').value.trim();
    if (title.length < 2 || title.length > 100) { $('cover-status').textContent = 'Skriv en titel med 2–100 tecken.'; return; }
    onSearch({ title, barcode: $('cover-keep-barcode').checked ? barcode : '' });
  };
  return { reset };
}
