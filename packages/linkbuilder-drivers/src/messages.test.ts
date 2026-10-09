import { describe, expect, it } from "vitest";
import { captchaRejected, classifyRegistration } from "./messages.js";

describe("registration notices", () => {
  it("treats a refused captcha as retryable, not as a board refusal", () => {
    const refused = [
      "Die von Ihnen eingegebene Antwort ist falsch",
      "The solution you provided was incorrect.",
      "The confirmation code you entered was incorrect.",
      "Der Bestätigungscode, den du eingegeben hast, war falsch.",
      "You have provided an invalid answer to the question.",
      "Du hast die Frage falsch beantwortet.",
      "The CAPTCHA verification failed. Please try again.",
      "Die Sicherheitsabfrage war ungültig.",
    ];
    for (const text of refused) {
      expect(captchaRejected(text), text).toBe(true);
      expect(classifyRegistration(text, true)).toEqual({ kind: "captcha_rejected" });
    }
  });

  it("leaves ordinary form errors alone", () => {
    for (const text of [
      "The username you entered is already in use.",
      "Der Benutzername ist bereits vergeben.",
      "Das Passwort muss zwischen 6 und 100 Zeichen lang sein.",
      "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
    ]) {
      expect(captchaRejected(text), text).toBe(false);
      expect(classifyRegistration(text, true).kind).toBe("form_error");
    }
  });
});
