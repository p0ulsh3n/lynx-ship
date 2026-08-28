const page = __CreatePage("0", 0);
const pageId = __GetElementUniqueID(page);
__SetClasses(page, "page");

const root = __CreateView(pageId);
__SetClasses(root, "root");
__AppendElement(page, root);

const eyebrow = __CreateText(pageId);
__SetClasses(eyebrow, "eyebrow");
__AppendElement(eyebrow, __CreateRawText("LYNXSHIP ANDROID DEMO"));
__AppendElement(root, eyebrow);

const title = __CreateText(pageId);
__SetClasses(title, "title");
__AppendElement(title, __CreateRawText("Ship your Lynx app"));
__AppendElement(root, title);

const description = __CreateText(pageId);
__SetClasses(description, "description");
__AppendElement(
  description,
  __CreateRawText(
    "A tiny Android-ready LynxJS project for the LynxShip build flow.",
  ),
);
__AppendElement(root, description);

const statusCard = __CreateView(pageId);
__SetClasses(statusCard, "card");
__AppendElement(root, statusCard);

const statusLabel = __CreateText(pageId);
__SetClasses(statusLabel, "card-label");
__AppendElement(statusLabel, __CreateRawText("BUILD TARGET"));
__AppendElement(statusCard, statusLabel);

const statusValue = __CreateText(pageId);
__SetClasses(statusValue, "card-value");
__AppendElement(statusValue, __CreateRawText("Android · production"));
__AppendElement(statusCard, statusValue);

const counterCard = __CreateView(pageId);
__SetClasses(counterCard, "card counter-card");
__AppendElement(root, counterCard);

const counterLabel = __CreateText(pageId);
__SetClasses(counterLabel, "card-label");
__AppendElement(counterLabel, __CreateRawText("LOCAL INTERACTION"));
__AppendElement(counterCard, counterLabel);

const counterText = __CreateText(pageId);
__SetClasses(counterText, "counter");
let counterRawText = __CreateRawText("0");
__AppendElement(counterText, counterRawText);
__AppendElement(counterCard, counterText);

const button = __CreateView(pageId);
__SetClasses(button, "button");
__SetAttribute(button, "aria-label", "Increment demo counter");
const buttonText = __CreateText(pageId);
__AppendElement(button, buttonText);
__AppendElement(buttonText, __CreateRawText("Tap to test Lynx"));
__AppendElement(root, button);

let count = 0;

function updateCounter(): void {
  count += 1;
  const nextCounterRawText = __CreateRawText(String(count));
  __ReplaceElements(counterText, [nextCounterRawText], [counterRawText]);
  counterRawText = nextCounterRawText;
  __FlushElementTree();
}

// Commit the initial tree before relying on a later event or update.
__FlushElementTree();

// __AddEventListener is newer than the core Element PAPI tree operations.
// Keep the static screen usable on older native runtimes.
if (typeof __AddEventListener === "function") {
  __AddEventListener(button, "tap", updateCounter, {});
}
