import { useEffect } from "react";
import { ChartCardContent, useChartData } from "./components/ChartCard.tsx";
import { host } from "./host.ts";
import { useStore } from "./store.ts";
import { useTheme } from "./theme.ts";

/**
 * One chart drawn to become a picture (`?picture=<chart id>`): a home-screen widget on Android is an image of the
 * same card, drawn by this page in a WebView that is never shown (apps/android, WidgetRenderer.kt). The card shows
 * the device's last copy at once, then the server's; when the data has settled the app is told to take the picture.
 */
export function PicturePage({ chartId }: { chartId: string }) {
  useTheme();
  const spec = useStore((s) => s.chartSpecs.find((c) => c.id === chartId));
  const state = useChartData(chartId);
  const settled = !state.loading && (state.data != null || state.error != null);

  useEffect(() => {
    if (!settled) return;
    // A moment for the card and its SVG to be laid out (a timer, not animation frames: the WebView that takes the
    // picture is never on screen, so it may not get frames).
    const timer = setTimeout(() => host.phone?.pictureReady(), 250);
    return () => clearTimeout(timer);
  }, [settled, state.data]);

  return (
    <div className="picture">
      <ChartCardContent
        title={spec?.title ?? state.data?.title ?? ""}
        color={spec?.color}
        state={state}
        compact
      />
    </div>
  );
}
