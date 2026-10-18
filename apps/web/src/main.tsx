import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { goBack, init } from "./store.ts";
import { WidgetPage } from "./Widget.tsx";
import "./styles.css";

// One page, two roles: the main window, or one desktop widget (`?widget=<id>&chart=<chart id>`).
const params = new URLSearchParams(location.search);
const widgetId = params.get("widget");
const chartId = params.get("chart");
const root = createRoot(document.getElementById("root")!);

if (widgetId && chartId) {
  document.documentElement.classList.add("widget-page");
  void init("widget").then(() =>
    root.render(
      <StrictMode>
        <WidgetPage widgetId={widgetId} chartId={chartId} />
      </StrictMode>,
    ),
  );
} else {
  // Android's Back button asks the page what to close (false: nothing open, the app goes to the background).
  (window as unknown as { __boniBack: () => boolean }).__boniBack = goBack;
  void init("main").then(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
