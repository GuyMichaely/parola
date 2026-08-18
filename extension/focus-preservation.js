const stagedList = document.getElementById("staged-list");
let focusedControl = null;

function describeControl(control) {
  const card = control.closest("[data-id]");
  if (!card?.dataset.id) return null;

  if (control.dataset.field) return { id: card.dataset.id, attribute: "data-field", value: control.dataset.field };
  if (control.dataset.detail) return { id: card.dataset.id, attribute: "data-detail", value: control.dataset.detail };
  if (control.dataset.action) return { id: card.dataset.id, attribute: "data-action", value: control.dataset.action };
  return null;
}

document.addEventListener("focusin", (event) => {
  const target = event.target;
  const control = target.closest?.("#staged-list [data-field], #staged-list [data-detail], #staged-list [data-action]");
  if (control) {
    focusedControl = describeControl(control);
    return;
  }

  if (target.matches?.("button, input, select, textarea, a[href], [tabindex]")) {
    focusedControl = null;
  }
});

new MutationObserver(() => {
  if (!focusedControl) return;

  const card = [...stagedList.querySelectorAll("[data-id]")]
    .find((candidate) => candidate.dataset.id === focusedControl.id);
  const target = card?.querySelector(`[${focusedControl.attribute}="${CSS.escape(focusedControl.value)}"]`);
  if (!target || document.activeElement === target) return;
  target.focus({ preventScroll: true });
}).observe(stagedList, { childList: true });
