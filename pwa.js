(() => {
  const button = document.getElementById('install-app');
  const help = document.getElementById('install-help');
  const status = document.getElementById('install-status');
  const connection = document.getElementById('connection-status');
  let promptEvent = null;
  function standalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }
  function refresh() {
    button.hidden = !promptEvent || standalone();
    help.hidden = standalone();
    connection.hidden = navigator.onLine !== false;
    connection.textContent = navigator.onLine === false
      ? 'Du verkar sakna internet. Anslut igen för att hämta, söka eller spara filmer.' : '';
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    refresh();
  });
  button.addEventListener('click', async () => {
    if (!promptEvent) return;
    const event = promptEvent;
    promptEvent = null;
    button.hidden = true;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      status.textContent = choice.outcome === 'accepted'
        ? 'Installationen har godkänts. Öppna Filmhyllan från ikonen när den visas.'
        : 'Du kan fortsätta använda Filmhyllan här och installera senare via webbläsarens meny.';
    } catch {
      status.textContent = 'Använd webbläsarens meny för att lägga till Filmhyllan på hemskärmen.';
    }
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    promptEvent = null;
    status.textContent = 'Filmhyllan har lagts till bland dina appar.';
    refresh();
  });
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  window.matchMedia('(display-mode: standalone)').addEventListener('change', refresh);
  refresh();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
      .catch(() => {
        status.textContent = 'Offlineinformationen kunde inte förberedas. Appen går fortfarande att använda med internet.';
      });
  }
})();
