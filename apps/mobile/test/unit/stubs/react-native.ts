// Just enough of react-native for the client's unit tests (node, no native modules).
export const Platform = { OS: 'web', select: <T,>(o: { web?: T; default?: T }) => o.web ?? o.default };
export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
export const I18nManager = { allowRTL() {}, isRTL: false };
export const AccessibilityInfo = { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) };
export const Linking = { openURL: async () => {}, openSettings: async () => {} };
export default { Platform, AppState, I18nManager, AccessibilityInfo, Linking };
