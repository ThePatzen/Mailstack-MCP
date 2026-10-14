// Copy the one-time token only after an explicit user action.
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy-token]');
  if (!button) return;
  const value = document.getElementById('new-token-value')?.textContent?.trim();
  const feedback = document.querySelector('.copy-feedback');
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    feedback.textContent = 'Token in die Zwischenablage kopiert.';
  } catch {
    feedback.textContent = 'Kopieren nicht möglich. Markieren Sie den Tokenwert und kopieren Sie ihn manuell.';
  }
});

// Confirm irreversible token actions before allowing their forms to submit.
document.addEventListener('submit', (event) => {
  if (event.target.matches('[data-confirm-revoke]') && !window.confirm('Dieses Token widerrufen? Verbundene Apps verlieren sofort den Zugriff.')) event.preventDefault();
  if (event.target.matches('[data-confirm-delete]') && !window.confirm('Dieses widerrufene Token und seine Berechtigungen dauerhaft löschen?')) event.preventDefault();
});
