// Fixture helper: replays the documented button labels against fake widgets on test pages.
(() => {
  const LABELS = {
    place: "Place the check",
    placing: "Placing…",
    placed: "Placed. Submit the form.",
    noToken: "No token",
    missingSiteKey: "Missing site key",
    unsupportedType: "Unsupported type",
  };
  const PLACING_MS = 250;

  for (const widget of document.querySelectorAll(".g-recaptcha, .cf-turnstile, .h-captcha")) {
    if (widget.querySelector("[data-page-helper]")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.pageHelper = "button";
    button.textContent = LABELS.place;
    let failuresLeft = Number(widget.getAttribute("data-fixture-no-token") ?? "0");

    button.addEventListener("click", () => {
      if (button.textContent === LABELS.placing) return;
      button.textContent = LABELS.placing;
      setTimeout(() => {
        const siteKey = widget.getAttribute("data-sitekey");
        if (widget.getAttribute("data-fixture-type") === "unsupported") {
          button.textContent = LABELS.unsupportedType;
        } else if (!siteKey) {
          button.textContent = LABELS.missingSiteKey;
        } else if (failuresLeft > 0) {
          failuresLeft -= 1;
          button.textContent = LABELS.noToken;
        } else {
          const field = widget.querySelector(
            "textarea[name='g-recaptcha-response'], input[name='cf-turnstile-response'], textarea[name='h-captcha-response']",
          );
          if (field) field.value = `fixture-token-${siteKey}-${Date.now()}`;
          button.textContent = LABELS.placed;
        }
      }, PLACING_MS);
    });
    widget.append(button);
  }
})();
