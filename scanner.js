// GTIN check digit; keep barcodes as text to preserve leading zeroes.
export function validBarcode(code) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(code[i]) * weight;
  }
  return (10 - sum % 10) % 10 === Number(code.at(-1));
}

export function createScanner({ video, panel, startButton, onScan, onMessage }) {
  let controls = null;
  let version = 0;
  let timeout = null;
  function stop() {
    version++;
    clearTimeout(timeout);
    controls?.stop();
    controls = null;
    const stream = video.srcObject;
    if (stream?.getTracks) stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    panel.hidden = true;
    startButton.disabled = false;
  }
  async function start() {
    stop();
    const current = version;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onMessage('Kameran kräver en webbläsare med kamerastöd och en säker https-adress. Du kan skriva streckkoden för hand.');
      return;
    }
    startButton.disabled = true;
    panel.hidden = false;
    onMessage('Startar kameran. Tillåt kameraåtkomst när mobilen frågar.');
    try {
      const { BrowserMultiFormatOneDReader } = await import('https://esm.sh/@zxing/browser@0.1.5');
      if (current !== version) return;
      const reader = new BrowserMultiFormatOneDReader();
      const active = await reader.decodeFromConstraints({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      }, video, (result, _error, liveControls) => {
        if (current !== version) { liveControls?.stop(); return; }
        if (!result) return;
        const code = result.getText().trim();
        if (!validBarcode(code)) return;
        liveControls?.stop();
        stop();
        onScan(code);
      });
      if (current !== version) { active.stop(); return; }
      controls = active;
      onMessage('Håll hela streckkoden i bilden. Prova ungefär 15–25 cm avstånd och bra ljus.');
      timeout = setTimeout(() => {
        if (current !== version) return;
        stop();
        onMessage('Ingen kod hittades inom en minut. Prova igen eller skriv numret för hand.');
      }, 60000);
    } catch (error) {
      if (current !== version) return;
      stop();
      const reason = error?.name;
      onMessage(reason === 'NotAllowedError'
        ? 'Kameraåtkomst nekades. Tillåt kameran i webbläsarens inställningar, eller skriv numret för hand.'
        : reason === 'NotFoundError'
          ? 'Ingen kamera hittades. Du kan skriva numret för hand.'
          : 'Kameran kunde inte starta. Stäng andra kameraappar och försök igen. Du kan också skriva numret för hand.');
    }
  }
  return { start, stop };
}
