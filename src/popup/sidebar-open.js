import { getSidebarPanelForUrl } from "../background/sidebar-panel.js";

export async function openSidebarFromUserGesture(sidebarAction, activeTab) {
  if (!sidebarAction?.open) {
    throw new Error("Sidebar API is unavailable in this popup context.");
  }

  if (Number.isInteger(activeTab?.id) && sidebarAction.setPanel) {
    await sidebarAction.setPanel({
      tabId: activeTab.id,
      panel: getSidebarPanelForUrl(activeTab?.url || "")
    });
  }

  return sidebarAction.open();
}
