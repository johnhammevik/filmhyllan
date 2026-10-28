import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createScanner, validBarcode } from './scanner.js?v=11';

const db = createClient('https://ncaffkxwowxytabemdra.supabase.co', 'sb_publishable_TL6D3152G-tkGQXsmUlDAQ_Z1DhMdm8');
const $ = id => document.getElementById(id);
let user = null;
let generation = 0;
let selectedMovie = null;
let searchVersion = 0;
let movieRows = [];
function categoryText(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
}
function categoryKey(value) { return categoryText(value).toLocaleLowerCase('sv'); }
function cleanCategory(value) {
  const text = categoryText(value);
  if ([...text].length > 60) throw new Error('Kategorin får ha högst 60 tecken.');
  if (!text) return null;
  return movieRows.map(movie => categoryText(movie.category)).find(name => categoryKey(name) === categoryKey(text)) || text;
}
function updateCategoryOptions() {
  const names = new Map();
  for (const movie of movieRows) {
    const name = categoryText(movie.category);
    if (name && !names.has(categoryKey(name))) names.set(categoryKey(name), name);
  }
  const previous = $('category-filter').value || 'all';
  $('category-filter').replaceChildren();
  $('category-options').replaceChildren();
  function option(value, label) {
    const element = document.createElement('option');
    element.value = value; element.textContent = label;
    $('category-filter').append(element);
  }
  option('all', 'Alla kategorier');
  option('none', 'Utan kategori');
  for (const [key, name] of [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], 'sv'))) {
    option(`category:${key}`, name);
    const suggestion = document.createElement('option');
    suggestion.value = name;
    $('category-options').append(suggestion);
  }
  $('category-filter').value = previous === 'none' || previous === 'all' || names.has(previous.slice(9)) ? previous : 'all';
}
const scanner = createScanner({
  video: $('scan-video'), panel: $('scan-panel'), startButton: $('scan-start'),
  onMessage: text => { $('scan-status').textContent = text; },
  onScan: code => {
    if (!user) return;
    clearSelection();
    searchVersion++;
    $('title').value = '';
    $('query').value = '';
    $('search-results').replaceChildren();
    $('search-status').textContent = '';
    $('barcode').value = code;
    $('scan-status').textContent = `Streckkod läst: ${code}. Söker efter titeln…`;
    searchTitles({ barcode: code });
  },
});
$('scan-start').onclick = () => { if (user) scanner.start(); };
$('scan-stop').onclick = () => { scanner.stop(); $('scan-status').textContent = 'Kameran är avstängd.'; };
window.addEventListener('pagehide', () => scanner.stop());
document.addEventListener('visibilitychange', () => { if (document.hidden) scanner.stop(); });
function poster(path, title) {
  const box = document.createElement('div');
  box.className = 'poster';
  box.textContent = 'Affisch saknas';
  if (typeof path === 'string' && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(path)) {
    const img = document.createElement('img');
    img.src = `https://image.tmdb.org/t/p/w342${path}`;
    img.alt = `Affisch för ${title}`;
    img.loading = 'lazy';
    img.onerror = () => { box.textContent = 'Affischen kunde inte laddas'; };
    box.replaceChildren(img);
  }
  return box;
}
function clearSelection() {
  selectedMovie = null;
  $('selection').hidden = true;
  $('selected-info').replaceChildren();
}
function message(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
async function busy(form, action) {
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(b => b.disabled = true);
  try { await action(); }
  catch (e) { message(e.message || 'Det gick inte att ansluta. Försök igen.', true); }
  finally { buttons.forEach(b => b.disabled = false); }
}
async function loadMovies() {
  if (!user) return;
  const current = generation;
  const owner = user.id;
  const all = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('movies').select('id,title,format,poster_path,barcode,media_type,category')
      .eq('user_id', owner).order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (current !== generation) return;
    if (error) throw error;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  movieRows = all;
  updateCategoryOptions();
  renderMovies();
}
function renderMovies() {
  const filter = $('category-filter').value || 'all';
  const normalize = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('sv');
  const terms = normalize($('collection-query').value).trim().split(/\s+/).filter(Boolean);
  const visible = movieRows.filter(movie =>
    (filter === 'all' || (filter === 'none' ? !categoryText(movie.category) : `category:${categoryKey(movie.category)}` === filter)) &&
    terms.every(term => normalize(movie.title).includes(term)));
  $('clear-collection-query').hidden = !$('collection-query').value;
  $('movies').replaceChildren();
  $('empty').hidden = visible.length !== 0;
  $('empty').textContent = !movieRows.length ? 'Din hylla väntar på sin första film. Lägg till den ovan.'
    : terms.length ? 'Ingen titel matchar sökningen. Prova färre ord eller välj Alla kategorier.' : 'Inga filmer i den här kategorin.';
  $('count').textContent = filter === 'all' && !terms.length ? `${movieRows.length} filmer` : `${visible.length} av ${movieRows.length} filmer`;
  for (const movie of visible) {
    const cardGeneration = generation;
    const cardOwner = user?.id;
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = movie.title;
    const format = document.createElement('div');
    format.textContent = `${movie.format} · ${movie.media_type === 'tv' ? 'Serie' : 'Film'}`;
    const remove = document.createElement('button');
    remove.className = 'secondary';
    remove.textContent = 'Ta bort';
    remove.setAttribute('aria-label', `Ta bort ${movie.title}`);
    remove.onclick = () => {
      if (!confirm(`Ta bort ”${movie.title}” från din hylla?`)) return;
      busy(li, async () => {
        if (!user) return;
        const { error } = await db.from('movies').delete().eq('id', movie.id).eq('user_id', user.id);
        if (error) throw error;
        await loadMovies();
        message('Filmen är borttagen.');
      });
    };
    li.append(poster(movie.poster_path, movie.title), title, format, remove);
    const categoryBadge = document.createElement('p');
    categoryBadge.className = 'category-badge';
    categoryBadge.textContent = categoryText(movie.category) || 'Utan kategori';
    const edit = document.createElement('details');
    edit.className = 'category-edit';
    const summary = document.createElement('summary');
    summary.textContent = 'Ändra kategori';
    const form = document.createElement('form');
    const label = document.createElement('label');
    label.textContent = 'Kategori';
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 60; input.value = categoryText(movie.category);
    input.setAttribute('list', 'category-options');
    input.placeholder = 'Skriv nytt eller välj befintligt';
    label.append(input);
    const save = document.createElement('button');
    save.type = 'submit'; save.className = 'secondary'; save.textContent = 'Spara kategori';
    const hint = document.createElement('small');
    hint.textContent = 'Lämna tomt för att ta bort kategorin.';
    form.append(label, hint, save);
    form.onsubmit = event => {
      event.preventDefault();
      busy(form, async () => {
        if (!user) throw new Error('Logga in igen.');
        const current = generation;
        const category = cleanCategory(input.value);
        const { data, error } = await db.from('movies').update({ category }).eq('id', movie.id).eq('user_id', user.id).select('id');
        if (current !== generation) return;
        if (error) throw error;
        if (!data?.length) throw new Error('Filmen kunde inte ändras. Ladda om hyllan och försök igen.');
        await loadMovies();
        if (current === generation) message('Kategorin har sparats.');
      });
    };
    edit.append(summary, form);
    li.append(categoryBadge, edit);
    const movieEdit = document.createElement('details');
    movieEdit.className = 'movie-edit';
    const editSummary = document.createElement('summary');
    editSummary.textContent = 'Redigera film';
    const editForm = document.createElement('form');
    function field(text, element) {
      const label = document.createElement('label');
      label.textContent = text;
      label.append(element);
      editForm.append(label);
      return element;
    }
    const editTitle = field('Titel', document.createElement('input'));
    editTitle.type = 'text'; editTitle.required = true; editTitle.maxLength = 300;
    const editFormat = field('Format', document.createElement('select'));
    for (const name of ['DVD', 'Blu-ray', '4K']) {
      const option = document.createElement('option');
      option.value = name; option.textContent = name; editFormat.append(option);
    }
    const editBarcode = field('Streckkod (valfritt)', document.createElement('input'));
    editBarcode.type = 'text'; editBarcode.inputMode = 'numeric'; editBarcode.maxLength = 14;
    const editHint = document.createElement('small');
    editHint.textContent = 'Skriv alla siffror i streckkoden, även inledande nollor. Affisch och kategori behålls.';
    const editStatus = document.createElement('p');
    editStatus.setAttribute('role', 'status'); editStatus.setAttribute('aria-live', 'polite');
    const saveMovie = document.createElement('button');
    saveMovie.type = 'submit'; saveMovie.textContent = 'Spara ändringar';
    const cancelMovie = document.createElement('button');
    cancelMovie.type = 'button'; cancelMovie.className = 'secondary'; cancelMovie.textContent = 'Avbryt';
    function resetEditor() {
      editTitle.value = movie.title;
      editFormat.value = movie.format;
      editBarcode.value = movie.barcode || '';
      editStatus.textContent = '';
    }
    resetEditor();
    cancelMovie.onclick = () => { resetEditor(); movieEdit.open = false; };
    editForm.append(editHint, editStatus, saveMovie, cancelMovie);
    editForm.onsubmit = event => {
      event.preventDefault();
      busy(editForm, async () => {
        try {
          if (!user || user.id !== cardOwner || generation !== cardGeneration) throw new Error('Öppna filmen igen efter att du loggat in.');
          const title = editTitle.value.trim();
          const format = editFormat.value;
          const barcode = editBarcode.value.trim();
          if (!title || [...title].length > 300) throw new Error('Skriv en titel med 1–300 tecken.');
          if (!['DVD', 'Blu-ray', '4K'].includes(format)) throw new Error('Välj DVD, Blu-ray eller 4K.');
          if (barcode && !validBarcode(barcode)) throw new Error('Streckkoden är ogiltig. Kontrollera siffrorna eller lämna fältet tomt.');
          editStatus.textContent = 'Sparar ändringarna…';
          const { data, error } = await db.from('movies').update({ title, format, barcode: barcode || null })
            .eq('id', movie.id).eq('user_id', cardOwner).select('id');
          if (generation !== cardGeneration) return;
          if (error) throw error;
          if (!data?.length) throw new Error('Filmen kunde inte ändras. Ladda om samlingen och försök igen.');
          await loadMovies();
          if (generation === cardGeneration) message('Filmens ändringar har sparats.');
        } catch (error) {
          if (generation !== cardGeneration) return;
          editStatus.textContent = error.message || 'Ändringarna kunde inte sparas. Försök igen.';
          throw error;
        }
      });
    };
    movieEdit.append(editSummary, editForm);
    li.append(movieEdit);
    if (movie.barcode) {
      const code = document.createElement('small');
      code.className = 'barcode-label';
      code.textContent = `Streckkod: ${movie.barcode}`;
      li.append(code);
    }
    $('movies').append(li);
  }
}
$('category-filter').onchange = renderMovies;
$('collection-query').oninput = renderMovies;
$('clear-collection-query').onclick = () => {
  $('collection-query').value = '';
  renderMovies();
  $('collection-query').focus();
};
async function showSession(session) {
  // Token refreshes must not clear an in-progress form or search.
  if (user && session?.user?.id === user.id) return;
  scanner.stop();
  $('scan-status').textContent = '';
  $('barcode').value = '';
  generation++;
  movieRows = [];
  $('collection-query').value = '';
  $('clear-collection-query').hidden = true;
  $('category').value = '';
  $('category-filter').value = 'all';
  updateCategoryOptions();
  searchVersion++;
  clearSelection();
  $('search-results').replaceChildren();
  $('search-status').textContent = '';
  $('search-form').reset();
  user = session?.user || null;
  document.documentElement.dataset.signedIn = user ? 'true' : 'false';
  window.dispatchEvent(new Event('filmhyllan-auth-changed'));
  $('movies').replaceChildren();
  $('count').textContent = '';
  $('empty').hidden = true;
  $('auth').hidden = !!user;
  $('collection').hidden = !user;
  $('account-email').textContent = user?.email || '';
  $('movie-form').reset();
  message(user ? 'Hämtar din filmhylla…' : 'Logga in eller skapa ett konto för att börja.');
  if (user) {
    try { await loadMovies(); message('Din filmhylla är redo.'); }
    catch (e) { message(`Kunde inte hämta filmer: ${e.message}`, true); }
  }
}
$('auth-form').onsubmit = event => {
  event.preventDefault();
  const signup = event.submitter?.name === 'signup';
  busy($('auth-form'), async () => {
    const credentials = { email: $('email').value.trim(), password: $('password').value };
    message(signup ? 'Skapar konto…' : 'Loggar in…');
    const { data, error } = signup
      ? await db.auth.signUp({ ...credentials, options: { emailRedirectTo: new URL('./', location.href).href } })
      : await db.auth.signInWithPassword(credentials);
    if (error) throw error;
    $('password').value = '';
    if (signup && !data.session) message('Kontrollera din e-post för en eventuell bekräftelselänk. Logga sedan in här.');
  });
};
$('movie-form').onsubmit = event => {
  event.preventDefault();
  busy($('movie-form'), async () => {
    if (!user) throw new Error('Logga in igen.');
    const title = $('title').value.trim();
    if (!title) throw new Error('Skriv en filmtitel.');
    const barcode = $('barcode').value.trim();
    if (barcode && !validBarcode(barcode)) throw new Error('Kontrollera streckkoden. Skriv alla siffror, även inledande nollor.');
    const current = generation;
    const category = cleanCategory($('category').value);
    const { error } = await db.from('movies').insert({ title, format: $('format').value, user_id: user.id, tmdb_id: selectedMovie?.id || null, poster_path: selectedMovie?.poster_path || null, barcode: barcode || null, media_type: selectedMovie?.media_type || $('media-type').value, category });
    if (current !== generation) return;
    if (error) throw error;
    $('movie-form').reset();
    clearSelection();
    $('scan-status').textContent = '';
    $('category-filter').value = 'all';
    $('collection-query').value = '';
    await loadMovies();
    message('Filmen har sparats.');
  });
};
$('clear-selection').onclick = () => {
  clearSelection();
  $('title').value = '';
  $('title').focus();
};
$('title').addEventListener('input', clearSelection);
$('media-type').addEventListener('change', clearSelection);
$('search-form').onsubmit = event => {
  event.preventDefault();
  searchTitles({ query: $('query').value.trim() });
};
$('lookup-barcode').onclick = () => {
  const barcode = $('barcode').value.trim();
  if (!validBarcode(barcode)) { message('Skriv eller skanna en giltig streckkod först.', true); return; }
  clearSelection();
  $('title').value = '';
  searchTitles({ barcode });
};
function searchTitles(body) {
  const current = ++searchVersion;
  const accountGeneration = generation;
  return busy($('search-form'), async () => {
    if (!user) throw new Error('Logga in för att söka.');
    $('search-results').replaceChildren();
    $('search-status').textContent = body.barcode ? 'Slår upp streckkoden och söker efter film eller serie…' : 'Söker efter filmer och serier…';
    try {
      const { data, error } = await db.functions.invoke('tmdb-search', { body });
      if (current !== searchVersion || accountGeneration !== generation) return;
      if (error) {
        let detail = '';
        try { detail = (await error.context.json()).error || ''; } catch { /* Network or gateway error. */ }
        throw new Error(detail || 'Sökningen misslyckades. Prova att logga ut och in igen. Du kan också registrera filmen manuellt.');
      }
      if (data?.error) throw new Error(data.error);
      if (!Array.isArray(data?.results)) throw new Error('Sökningen gav ett oväntat svar.');
      if (body.barcode) {
        $('scan-status').textContent = data.lookup_source === 'collection'
          ? `Redan på din hylla: ${data.product.title}. Ingen ny kopia sparas om du inte väljer förslaget och klickar på Spara film.`
          : data.product
          ? `Produkt: ${data.product.title} (källa: ${data.product.source}). Kontrollera att förslaget stämmer.`
          : data.lookup_message || 'Ingen produkttitel hittades. Sök på titeln manuellt.';
        if (data.query) $('query').value = data.query;
        if (['DVD', 'Blu-ray', '4K'].includes(data.product?.format)) $('format').value = data.product.format;
      }
      $('search-status').textContent = data.results.length ? `${data.results.length} förslag. Välj rätt film eller serie nedan.` : data.lookup_message || 'Ingen träff. Prova en annan titel eller registrera manuellt nedan.';
      for (const movie of data.results) {
        const savedResult = data.lookup_source === 'collection' && typeof movie.saved_id === 'string';
        if ((!Number.isInteger(movie.id) && !savedResult) || typeof movie.title !== 'string') continue;
        const li = document.createElement('li');
        const name = document.createElement('h3');
        const year = /^\d{4}/.exec(movie.release_date || '')?.[0];
        name.textContent = `${movie.title}${year ? ` (${year})` : ''} · ${movie.media_type === 'tv' ? 'Serie' : 'Film'}`;
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.textContent = 'Välj film';
        choose.setAttribute('aria-label', `Välj ${name.textContent}`);
        choose.onclick = () => {
          selectedMovie = movie;
          $('title').value = movie.title;
          $('media-type').value = movie.media_type === 'tv' ? 'tv' : 'movie';
          const label = document.createElement('p');
          label.textContent = `Vald film: ${name.textContent}`;
          $('selected-info').replaceChildren(poster(movie.poster_path, movie.title), label);
          $('selection').hidden = false;
          $('movie-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
          $('format').focus({ preventScroll: true });
          message('Kontrollera formatet och klicka på Spara film.');
        };
        li.append(poster(movie.poster_path, movie.title), name, choose);
        $('search-results').append(li);
      }
    } catch (e) {
      if (current === searchVersion && accountGeneration === generation) {
        $('search-status').textContent = e.message;
        if (body.barcode) $('scan-status').textContent = 'Koden är läst, men uppslaget misslyckades. Sök på titeln manuellt eller prova igen.';
      }
    }
  });
}
$('logout').onclick = () => busy($('collection'), async () => {
  const { error } = await db.auth.signOut({ scope: 'local' });
  if (error) throw error;
});
// Keep database calls outside the synchronous auth callback.
db.auth.onAuthStateChange((_event, session) => { setTimeout(() => showSession(session), 0); });
const { data, error } = await db.auth.getSession();
if (error) message(error.message, true);
else await showSession(data.session);
