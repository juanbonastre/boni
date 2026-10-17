import { useEffect, useState } from "react";
import { getHost, networkAllowed } from "../host.ts";
import { t } from "../i18n.ts";

/**
 * Says so when the app may not use the network (GrapheneOS's per-app "Network" permission, which no
 * dialog can ask for) and opens the settings page where it is turned on. Renders nothing otherwise.
 */
export function NetworkHint() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let live = true;
    void networkAllowed().then((ok) => live && setBlocked(!ok));
    return () => {
      live = false;
    };
  }, []);
  if (!blocked) return null;
  return (
    <div className="network-hint" role="alert">
      <span>{t("network.blocked")}</span>
      <button type="button" className="btn" onClick={() => getHost().network?.openSettings()}>
        {t("network.openSettings")}
      </button>
    </div>
  );
}
