import { showLoading, hideLoading, showAlert } from './4_ui.js';
import { apiFetch } from './api.js';

export async function sendEmail({ to, subject, message }) {
  if (!to || !subject || !message) {
    showAlert("❌ E-mail niet verstuurd: ontbrekende gegevens.", "error");
    return;
  }

  try {
    showLoading();
    const response = await apiFetch('/send_email.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, message })
    });

    const result = await response.json();
    hideLoading();

    if (!result.success) {
      throw new Error(result.error);
    }

    showAlert("✅ E-mail succesvol verzonden.", "success");
  } catch (err) {
    hideLoading();
    console.error("E-mail verzenden mislukt:", err);
    showAlert(`⚠️ E-mail mislukt: ${err.message}`, "error");
  }
}
