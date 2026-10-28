import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const db = createClient('https://ncaffkxwowxytabemdra.supabase.co', 'sb_publishable_TL6D3152G-tkGQXsmUlDAQ_Z1DhMdm8');
const $ = id => document.getElementById(id);
let user = null;
let generation = 0;
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
  const { data, error } = await db.from('movies').select('id,title,format').eq('user_id', user.id).order('created_at', { ascending: false });
  if (current !== generation) return;
  if (error) throw error;
  $('movies').replaceChildren();
  $('empty').hidden = data.length !== 0;
  $('count').textContent = `${data.length} filmer`;
  for (const movie of data) {
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = movie.title;
    const format = document.createElement('div');
    format.textContent = movie.format;
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
    li.append(title, format, remove);
    $('movies').append(li);
  }
}
async function showSession(session) {
  generation++;
  user = session?.user || null;
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
    const { error } = await db.from('movies').insert({ title, format: $('format').value, user_id: user.id });
    if (error) throw error;
    $('movie-form').reset();
    await loadMovies();
    message('Filmen har sparats.');
  });
};
$('logout').onclick = () => busy($('collection'), async () => {
  const { error } = await db.auth.signOut({ scope: 'local' });
  if (error) throw error;
});
// Keep database calls outside the synchronous auth callback.
db.auth.onAuthStateChange((_event, session) => { setTimeout(() => showSession(session), 0); });
const { data, error } = await db.auth.getSession();
if (error) message(error.message, true);
else await showSession(data.session);
