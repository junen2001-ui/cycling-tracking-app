const { withAndroidStyles } = require('expo/config-plugins');

// Android 10+のシステムのForce Dark機能により、ダークテーマ端末でreact-native-mapsの
// 地図表示が反転して見える問題への対策。userInterfaceStyle:"light"だけではAppTheme側の
// android:forceDarkAllowedには反映されないため、明示的にfalseを注入する。
module.exports = function withAndroidForceDarkDisabled(config) {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults;
    const appTheme = styles.resources.style?.find((s) => s.$.name === 'AppTheme');
    if (appTheme) {
      appTheme.item = (appTheme.item || []).filter(
        (item) => item.$.name !== 'android:forceDarkAllowed'
      );
      appTheme.item.push({ $: { name: 'android:forceDarkAllowed' }, _: 'false' });
    }
    return config;
  });
};
