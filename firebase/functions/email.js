// email.js - Utility for sending emails via Brevo (Sendinblue)
const SibApiV3Sdk = require('sib-api-v3-sdk');
const functions = require('firebase-functions');

// Load API key from Firebase config (prod) or env (dev)
function getBrevoApiKey() {
  if (process.env.FUNCTIONS_EMULATOR) {
    // Local dev: .env.functions.local
    return process.env.BREVO_API_KEY;
  } else {
    // Production: Firebase Runtime Config
    return functions.config().brevo && functions.config().brevo.apikey;
  }
}

const sendEmail = async ({ to, subject, htmlContent, sender }) => {
  const apiKey = getBrevoApiKey();
  if (!apiKey) throw new Error('Brevo API key not set');

  SibApiV3Sdk.ApiClient.instance.authentications['api-key'].apiKey = apiKey;
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  sendSmtpEmail.to = Array.isArray(to) ? to : [{ email: to }];
  sendSmtpEmail.sender = sender || { email: 'noreply@yourdomain.com', name: 'Your Store' };
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = htmlContent;

  try {
    const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
    return response;
  } catch (error) {
    console.error('Brevo sendEmail error:', error);
    throw error;
  }
};

module.exports = { sendEmail };
