export function getSidebarRunAvailability(sidebarAttempt, bridgeStatus) {
  const sidebarOpened = Boolean(sidebarAttempt?.opened);
  const bridgeReachable = Boolean(bridgeStatus?.reachable);

  return {
    sidebarOpened,
    bridgeReachable,
    canProceed: sidebarOpened || bridgeReachable,
    reusedExistingBridge: !sidebarOpened && bridgeReachable
  };
}
