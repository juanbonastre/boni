import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { PeekPage } from "./components/Peek.tsx";
import { PicturePage } from "./Picture.tsx";
import { androidBack, init } from "./store.ts";
import { WidgetPage } from "./Widget.tsx";
import "./styles.css";

// One page, four roles: the main window, one desktop widget (`?widget=<id>&chart=<chart id>`), the picture of one
// chart for an Android home-screen widget (`?picture=<chart id>`), or the desktop's peek (`?peek=1`: a note opened
// from another app, in a small window).
const params = new URLSearchParams(location.search);
const widgetId = params.get("widget");
const chartId = params.get("chart");
const root = createRoot(document.getElementById("root")!);

const pictureId = params.get("picture");

if (pictureId) {
  // A home-screen widget's picture (Android): one chart, drawn off screen.
  document.documentElement.classList.add("widget-page");
  void init("widget").then(() =>
    root.render(
      <StrictMode>
        <PicturePage chartId={pictureId} />
      </StrictMode>,
    ),
  );
} else if (params.get("peek") === "1") {
  document.documentElement.classList.add("peek-page");
  void init("peek").then(() =>
    root.render(
      <StrictMode>
        <PeekPage />
      </StrictMode>,
    ),
  );
} else if (widgetId && chartId) {
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
  (window as unknown as { __boniBack: () => boolean }).__boniBack = androidBack;
  void init("main").then(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
