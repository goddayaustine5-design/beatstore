/* ===== Austino Pro: site settings. Edit this file only; no other file needs changing. ===== */
window.SITE_CONFIG = {
  // Your WhatsApp number in international format: country code 234, then the number WITHOUT its leading 0.
  // No plus sign, spaces, dashes or brackets. Example: 0801 234 5678 becomes "2348012345678".
  // Used by cart checkout and the "Request a custom beat" button.
  whatsappNumber: "2349010216751",

  // ONLINE PAYMENT (Flutterwave "Pay now" button). Leave blank to keep WhatsApp as the only checkout.
  // Paste your PUBLIC key from the Flutterwave dashboard (Settings, API keys). It starts with FLWPUBK.
  // Use the TEST public key (FLWPUBK_TEST-...) while testing and the LIVE one when you are ready.
  // NEVER paste your secret key (it starts with FLWSECK) anywhere on this site.
  flutterwavePublicKey: "FLWPUBK-1fe10fd6fb5418efcbf460fe40e49475-X",

  // CONTACT FORM DELIVERY (set ONE of these; the form shows a "not set up yet" message until you do):
  // 1) Best: a form-service address such as Formspree. Create a free form at formspree.io,
  //    then paste its address here, for example "https://formspree.io/f/abcdwxyz".
  //    Messages are then emailed to you directly and the visitor never leaves your site.
  contactFormEndpoint: "",
  // 2) Simple fallback: your email address. The visitor's email app opens with the message ready to send.
  contactEmail: ""
};
