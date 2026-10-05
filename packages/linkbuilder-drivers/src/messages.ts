import type { RegistrationResult } from "./driver.js";

/**
 * Board notices shared by the platform drivers. phpBB keeps its own copy so its fixture
 * behaviour stays as it was; these patterns match the same English and German phrases.
 */

const PENDING_EMAIL =
  /activation key has been sent|check your e-?mail|aktivierungsschlüssel .* gesendet|e-?mail.*(aktivier|bestätig)/i;
const PENDING_ADMIN =
  /administrator (must|will) (activate|approve)|activation by an administrator|vom administrator (freigeschaltet|aktiviert)/i;
const ACTIVE =
  /account has (now )?been (created|activated|registered)|you (may|can) now (log ?in|login)|registrierung (war|ist) erfolgreich|konto wurde (aktiviert|erstellt)/i;
const CAPTCHA_REJECTED =
  /confirmation code you entered was incorrect|solution you provided was incorrect|bestätigungscode .* (falsch|nicht korrekt)|did not pass the security check|captcha prüfung fehlgeschlagen/i;
const REGISTRATION_CLOSED =
  /registration (is )?(disabled|closed)|registrierung (ist )?deaktiviert/i;
const POSTED =
  /posted successfully|erfolgreich (erstellt|gespeichert|eingetragen)|reply has been posted/i;

const FIXABLE_FORM =
  /already (?:in use|taken|registered|exists)|username you entered is already|banned email|email address is banned|e-?mail .* (?:gesperrt|banned|not allowed)|password is required|passworts ist erforderlich|entering a password is required/i;
const USERNAME_TAKEN =
  /already (?:in use|taken|registered|exists)|username you entered is already|benutzername .* vergeben/i;

export function registrationClosed(text: string): boolean {
  return REGISTRATION_CLOSED.test(text);
}

export function postedSuccessfully(text: string): boolean {
  return POSTED.test(text);
}

/** Username taken, a banned email, or a missing password: correct the form once, then give up. */
export function formErrorFixable(messages: readonly string[]): boolean {
  return FIXABLE_FORM.test(messages.join("\n"));
}

export function usernameTaken(messages: readonly string[]): boolean {
  return USERNAME_TAKEN.test(messages.join("\n"));
}

export function classifyRegistration(text: string, formStillOpen: boolean): RegistrationResult {
  if (CAPTCHA_REJECTED.test(text)) return { kind: "captcha_rejected" };
  if (PENDING_ADMIN.test(text)) return { kind: "pending_admin" };
  if (PENDING_EMAIL.test(text)) return { kind: "pending_email" };
  if (ACTIVE.test(text) && !formStillOpen) return { kind: "active" };
  const messages = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (formStillOpen) return { kind: "form_error", messages };
  return { kind: "unknown", messages };
}

export function relFromAttribute(rel: string | null): "follow" | "nofollow" | "ugc" | null {
  if (rel === null) return null;
  const value = rel.toLowerCase();
  if (/\bnofollow\b|\bsponsored\b/.test(value)) return "nofollow";
  if (/\bugc\b/.test(value)) return "ugc";
  return "follow";
}
