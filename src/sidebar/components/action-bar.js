export function bindActionBar(nodes, handlers) {
  const {
    regenerateButton,
    openBridgeButton,
    followUpForm,
    followUpInput,
    followUpSubmit
  } = nodes;
  const {
    onRegenerate,
    onOpenBridge,
    onFollowUp
  } = handlers;

  regenerateButton.addEventListener("click", () => {
    onRegenerate();
  });

  openBridgeButton.addEventListener("click", () => {
    onOpenBridge();
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
      openBridgeButton.disabled = disabled;
      followUpInput.disabled = disabled;
      followUpSubmit.disabled = disabled;
    }
  };
}
