const { withMainApplication } = require('expo/config-plugins');

// userInterfaceStyle:"light"だけではAndroidネイティブ側のAppCompatDelegateの
// ナイトモード設定(DayNightテーマがシステム設定に追従する挙動)には反映されない。
// テーマがシステムのダークモードに追従したままだと、Google Maps SDKもそれを見て
// 地図をダーク表示してしまうため、MainApplication.ktのonCreate()に
// AppCompatDelegate.setDefaultNightMode(MODE_NIGHT_NO)を明示的に注入する。
module.exports = function withAndroidForceLightMode(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes('androidx.appcompat.app.AppCompatDelegate')) {
      contents = contents.replace(
        'import android.app.Application',
        'import android.app.Application\nimport androidx.appcompat.app.AppCompatDelegate'
      );
    }

    if (!contents.includes('setDefaultNightMode')) {
      contents = contents.replace(
        'override fun onCreate() {\n    super.onCreate()',
        'override fun onCreate() {\n    super.onCreate()\n    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)'
      );
    }

    config.modResults.contents = contents;
    return config;
  });
};
