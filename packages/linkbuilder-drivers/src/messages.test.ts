import { describe, expect, it } from "vitest";
import {
  adminActivationNotice,
  captchaRejected,
  classifyRegistration,
  formErrorFixable,
} from "./messages.js";

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

  it("classifies the registration answers the generic flow retries or stops on", () => {
    expect(classifyRegistration("Please enter your birthday.", true).kind).toBe("form_error");
    expect(formErrorFixable(["Please enter your birthday."])).toBe(true);
    expect(formErrorFixable(["The username you entered is already in use."])).toBe(true);
    expect(
      classifyRegistration(
        "An activation key has been sent to the email address you provided.",
        false,
      ).kind,
    ).toBe("pending_email");
    expect(
      classifyRegistration(
        "An administrator will activate your account before you can log in.",
        false,
      ).kind,
    ).toBe("pending_admin");
    expect(classifyRegistration("Your account has now been activated.", false).kind).toBe("active");
    expect(
      classifyRegistration(
        "Information Dein Benutzerkonto wurde erstellt. Es muss jedoch erst durch einen Administrator freigeschaltet werden. Die Administratoren wurden per E-Mail informiert.",
        true,
      ).kind,
    ).toBe("pending_admin");
    expect(
      adminActivationNotice(
        "Dein Benutzerkonto wurde erstellt. Es muss jedoch erst durch einen Administrator freigeschaltet werden.",
      ),
    ).toBe(true);
    expect(
      adminActivationNotice("An administrator must activate your account before you can log in."),
    ).toBe(true);
    expect(adminActivationNotice("An activation key has been sent to your email.")).toBe(false);
  });
});
