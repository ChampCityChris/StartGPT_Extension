export function bindActionBar(nodes, handlers) {
  const {
    regenerateButton,
    openSettingsButton,
    followUpForm,
    followUpInput,
    followUpSubmit
  } = nodes;
  const {
    onRegenerate,
    onOpenSettings,
    onFollowUp
  } = handlers;

  regenerateButton.addEventListener("click", () => {
    onRegenerate();
  });

  openSettingsButton.addEventListener("click", () => {
    onOpenSettings();
  });

  followUpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = String(followUpInput.value || "").trim();
    if (!question) {
      return;
    }
    onFollowUp(question);
    followUpInput.value = "";
  });

  return {
    setDisabled(disabled) {
      regenerateButton.disabled = disabled;
      followUpInput.disabled = disabled;
      followUpSubmit.disabled = disabled;
    }
  };
}
